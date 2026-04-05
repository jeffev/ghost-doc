package io.ghostdoc.agent.core;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Fire-and-forget WebSocket transport for the Ghost Doc Hub.
 *
 * <ul>
 *   <li>Reconnects with exponential back-off (1s → 30s cap)</li>
 *   <li>Flushes the offline ring-buffer automatically on reconnect</li>
 *   <li>Batches outgoing events: accumulates for up to 50ms before sending a JSON array</li>
 *   <li>Thread-safe: {@code send()} may be called from any thread</li>
 *   <li>Never throws: all errors are logged to stderr with {@code [ghost-doc]} prefix</li>
 * </ul>
 */
public final class WsTransport {

    private static final long BASE_RETRY_MS    = 1_000L;
    private static final long MAX_RETRY_MS     = 30_000L;
    private static final int  WARN_AFTER       = 10;
    private static final long BATCH_DELAY_MS   = 50L;

    private final URI                     hubUri;
    private final RingBuffer<String>      offlineBuffer;
    private final ScheduledExecutorService scheduler;

    private final AtomicBoolean  destroyed      = new AtomicBoolean(false);
    private final AtomicBoolean  connected      = new AtomicBoolean(false);
    private final AtomicInteger  retryAttempt   = new AtomicInteger(0);

    // Guarded by batchLock
    private final Object          batchLock     = new Object();
    private final StringBuilder   batchBuilder  = new StringBuilder("[");
    private int                   batchCount    = 0;
    private ScheduledFuture<?>    batchFuture   = null;

    private volatile InternalWsClient wsClient  = null;

    public WsTransport(String hubUrl, RingBuffer<String> offlineBuffer) {
        try {
            this.hubUri = URI.create(hubUrl);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid Hub URL: " + hubUrl, e);
        }
        this.offlineBuffer = offlineBuffer;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "ghost-doc-transport");
            t.setDaemon(true);
            return t;
        });
    }

    public void connect() {
        if (destroyed.get()) return;
        openConnection();
    }

    private void openConnection() {
        if (destroyed.get()) return;
        try {
            InternalWsClient client = new InternalWsClient(hubUri);
            this.wsClient = client;
            client.connect();
        } catch (Exception e) {
            scheduleReconnect();
        }
    }

    private void scheduleReconnect() {
        if (destroyed.get()) return;
        int attempt = retryAttempt.incrementAndGet();
        if (attempt == WARN_AFTER) {
            System.err.println("[ghost-doc] Hub at " + hubUri + " is unreachable after " +
                attempt + " attempts. Traces are buffered locally. Run `npx ghost-doc start`.");
        }
        long delay = Math.min(BASE_RETRY_MS * (1L << (attempt - 1)), MAX_RETRY_MS);
        scheduler.schedule(this::openConnection, delay, TimeUnit.MILLISECONDS);
    }

    private void onConnected() {
        connected.set(true);
        retryAttempt.set(0);
        flushOfflineBuffer();
    }

    private void onDisconnected() {
        connected.set(false);
        wsClient = null;
        scheduleReconnect();
    }

    private void flushOfflineBuffer() {
        List<String> pending = offlineBuffer.drain();
        if (pending.isEmpty()) return;
        // Send each buffered JSON string as a single-element batch.
        // Re-batch them into one array for efficiency.
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < pending.size(); i++) {
            sb.append(pending.get(i));
            if (i < pending.size() - 1) sb.append(',');
        }
        sb.append("]");
        rawSend(sb.toString());
    }

    /**
     * Queue a JSON span string for sending. Thread-safe.
     * If not connected, the span is placed in the offline ring buffer.
     */
    public void send(String spanJson) {
        if (!connected.get()) {
            offlineBuffer.push(spanJson);
            return;
        }
        synchronized (batchLock) {
            if (batchCount > 0) batchBuilder.append(',');
            batchBuilder.append(spanJson);
            batchCount++;
            if (batchFuture == null) {
                batchFuture = scheduler.schedule(this::flushBatch, BATCH_DELAY_MS, TimeUnit.MILLISECONDS);
            }
        }
    }

    private void flushBatch() {
        String payload;
        synchronized (batchLock) {
            if (batchCount == 0) return;
            batchBuilder.append("]");
            payload = batchBuilder.toString();
            batchBuilder.setLength(0);
            batchBuilder.append("[");
            batchCount = 0;
            batchFuture = null;
        }
        rawSend(payload);
    }

    private void rawSend(String payload) {
        InternalWsClient client = wsClient;
        if (client == null || !client.isOpen()) {
            // Re-buffer individual spans from the payload (best-effort parse).
            offlineBuffer.push(payload);
            return;
        }
        try {
            client.send(payload);
        } catch (Exception e) {
            System.err.println("[ghost-doc] Failed to send span batch, re-buffering: " + e.getMessage());
            offlineBuffer.push(payload);
        }
    }

    /** Close the connection and stop all background threads. */
    public void disconnect() {
        if (!destroyed.compareAndSet(false, true)) return;
        // Flush any pending batch immediately.
        synchronized (batchLock) {
            if (batchFuture != null) {
                batchFuture.cancel(false);
                batchFuture = null;
            }
            batchBuilder.setLength(0);
            batchCount = 0;
        }
        InternalWsClient client = wsClient;
        if (client != null) {
            try { client.closeBlocking(); } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        scheduler.shutdownNow();
    }

    public boolean isConnected() { return connected.get(); }

    // -------------------------------------------------------------------------
    // Internal WebSocket client
    // -------------------------------------------------------------------------

    private final class InternalWsClient extends WebSocketClient {

        InternalWsClient(URI uri) {
            super(uri);
            setConnectionLostTimeout(30);
        }

        @Override
        public void onOpen(ServerHandshake handshake) {
            onConnected();
        }

        @Override
        public void onMessage(String message) {
            // Hub never sends messages to agents — ignore.
        }

        @Override
        public void onClose(int code, String reason, boolean remote) {
            connected.set(false);
            if (!destroyed.get()) {
                onDisconnected();
            }
        }

        @Override
        public void onError(Exception ex) {
            // Always followed by onClose; suppress noisy connection-refused errors.
            if (ex != null && ex.getMessage() != null &&
                    !ex.getMessage().contains("Connection refused")) {
                System.err.println("[ghost-doc] ws error: " + ex.getMessage());
            }
        }
    }
}

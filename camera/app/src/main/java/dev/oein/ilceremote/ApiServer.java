package dev.oein.ilceremote;

import com.github.ma1co.openmemories.framework.DeviceInfo;

import org.json.JSONException;
import org.json.JSONObject;

import fi.iki.elonen.NanoHTTPD;

/** HTTP API for the viewer app. */
public class ApiServer extends NanoHTTPD {
    public static final int PORT = 8080;

    private static final java.util.regex.Pattern PHOTO_PATH =
            java.util.regex.Pattern.compile("^/api/photos/(\\d+)(?:/(thumb|micro|small|preview|full|raw))?$");

    private final LiveView liveView;
    private final PhotoLibrary photos;
    private final CameraControl camera;
    /** Debug: renders the camera's screen as PNG, given a live view JPEG (or null) for the background. */
    public interface ScreenCapture {
        byte[] capture(byte[] liveViewJpeg) throws Exception;
    }

    private ScreenCapture screenCapture;


    public void setScreenCapture(ScreenCapture capture) {
        screenCapture = capture;
    }

    /** Debug builds only: lets tools/dev-install.sh close the app cleanly without losing Wi-Fi/adb. */
    private final Runnable debugExit;

    public ApiServer(LiveView liveView, PhotoLibrary photos, CameraControl camera, Runnable debugExit) {
        super(PORT);
        this.liveView = liveView;
        this.photos = photos;
        this.camera = camera;
        this.debugExit = debugExit;
    }

    @Override
    public Response serve(IHTTPSession session) {
        try {
            String uri = session.getUri();
            if ("/api/info".equals(uri)) {
                return json(info());
            }
            if ("/api/camera".equals(uri)) {
                if (session.getMethod() == Method.POST) {
                    return json(camera.apply(new JSONObject(body(session))));
                }
                return json(camera.state());
            }
            if ("/api/camera/shutter".equals(uri) && session.getMethod() == Method.POST) {
                return json(camera.shoot());
            }
            if ("/api/camera/focus".equals(uri) && session.getMethod() == Method.POST) {
                JSONObject request = new JSONObject(body(session));
                return json(camera.focus(!"stop".equals(request.optString("action", "start"))));
            }
            if ("/api/camera/focusdrive".equals(uri) && session.getMethod() == Method.POST) {
                JSONObject request = new JSONObject(body(session));
                return json(camera.focusDrive(request.optString("direction"), request.optInt("speed", 0)));
            }
            if ("/api/camera/zoom".equals(uri) && session.getMethod() == Method.POST) {
                JSONObject request = new JSONObject(body(session));
                if (request.has("target")) {
                    return json(camera.zoomTo(request.getDouble("target")));
                }
                return json(camera.zoom(request.optString("direction"), request.optInt("speed", 0)));
            }
            if ("/api/camera/magnify".equals(uri) && session.getMethod() == Method.POST) {
                JSONObject request = new JSONObject(body(session));
                return json(camera.magnify(request.optString("action"), request.optDouble("dx", 0),
                        request.optDouble("dy", 0)));
            }
            if ("/api/camera/params".equals(uri)) {
                return newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, camera.rawParameters());
            }
            if ("/api/photos".equals(uri)) {
                java.util.Map<String, String> params = session.getParms();
                int offset = Math.max(0, intParam(params, "offset", 0));
                int limit = Math.max(1, Math.min(500, intParam(params, "limit", 100)));
                return json(photos.list(offset, limit));
            }
            java.util.regex.Matcher photo = PHOTO_PATH.matcher(uri);
            if (photo.matches()) {
                return photo(Long.parseLong(photo.group(1)), photo.group(2));
            }
            if ("/api/liveview".equals(uri)) {
                return liveViewStream();
            }
            if ("/api/liveview.jpg".equals(uri)) {
                return liveViewFrame();
            }
            if (uri.startsWith("/api/debug/") && BuildConfig.DEBUG) {
                return debug(uri, session);
            }
            if (!uri.startsWith("/api/") && webAssets != null) {
                return webFile(uri, session);
            }
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found: " + uri);
        } catch (IllegalArgumentException e) {
            return newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, e.toString());
        } catch (Exception e) {
            Logger.error("API " + session.getUri() + " failed", e);
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.toString());
        }
    }

    // --- web app -----------------------------------------------------------------------------------
    // The phone app's features as a web app (assets/web), for any browser; "/" is its page.

    private android.content.res.AssetManager webAssets;

    public void setWebAssets(android.content.res.AssetManager assets) {
        webAssets = assets;
    }

    /** Files only change with the app, so its version is their ETag. */
    private static final String WEB_ETAG = "\"" + BuildConfig.VERSION_CODE + "\"";

    private Response webFile(String uri, IHTTPSession session) {
        String path = "/".equals(uri) ? "index.html" : uri.substring(1);
        if (path.contains("..")) {
            return notFound();
        }
        if (WEB_ETAG.equals(session.getHeaders().get("if-none-match"))) {
            Response unchanged = newFixedLengthResponse(Response.Status.NOT_MODIFIED, MIME_PLAINTEXT, "");
            unchanged.addHeader("ETag", WEB_ETAG);
            return unchanged;
        }
        // The build stores a gzipped copy of the text files: send that when the browser takes it,
        // which saves the camera both the bytes over its slow Wi-Fi and compressing them each time
        String encodings = session.getHeaders().get("accept-encoding");
        boolean gzip = false;
        byte[] data = null;
        if (encodings != null && encodings.contains("gzip")) {
            data = readAsset("web/" + path + ".gzip");
            gzip = data != null;
        }
        if (data == null) {
            data = readAsset("web/" + path);
        }
        if (data == null) {
            return notFound();
        }
        Response response = newFixedLengthResponse(Response.Status.OK, webType(path),
                new java.io.ByteArrayInputStream(data), data.length);
        if (gzip) {
            response.addHeader("Content-Encoding", "gzip"); // see useGzipWhenAccepted
        }
        response.addHeader("Vary", "Accept-Encoding");
        response.addHeader("ETag", WEB_ETAG);
        response.addHeader("Cache-Control", "no-cache"); // revalidate: a 304 costs next to nothing
        return response;
    }

    /** NanoHTTPD gzips text responses itself: not the ones that already are. */
    @Override
    protected boolean useGzipWhenAccepted(Response r) {
        return r.getHeader("Content-Encoding") == null && super.useGzipWhenAccepted(r);
    }

    /** The asset's bytes, or null if there's no such file. */
    private byte[] readAsset(String name) {
        try {
            java.io.InputStream in = webAssets.open(name);
            try {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                }
                return out.toByteArray();
            } finally {
                in.close();
            }
        } catch (java.io.IOException e) {
            return null;
        }
    }

    private static String webType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private Response debug(String uri, IHTTPSession session) throws InterruptedException {
        java.util.Map<String, String> params = session.getParms();
        if ("/api/debug/exit".equals(uri) && debugExit != null) {
            debugExit.run();
            return newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, "Exiting");
        }
        if ("/api/debug/stats".equals(uri)) {
            return newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, liveView.stats() + "\n");
        }
        if ("/api/debug/liveview".equals(uri)) {
            String result = liveView.reconfigure(intParam(params, "w", 0), intParam(params, "h", 0),
                    intParam(params, "rate", -1), intParam(params, "interval", 0));
            return newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, result + "\n");
        }
        if ("/api/debug/screenshot".equals(uri) && screenCapture != null) {
            byte[] background = null;
            if (liveView.isRunning()) {
                liveView.addClient();
                try {
                    LiveView.Frame frame = liveView.awaitFrame(0, 3000);
                    background = frame == null ? null : frame.jpeg;
                } finally {
                    liveView.removeClient();
                }
            }
            byte[] png;
            try {
                png = screenCapture.capture(background);
            } catch (Exception e) {
                throw new IllegalStateException("Screen capture failed", e);
            }
            return newFixedLengthResponse(Response.Status.OK, "image/png", new java.io.ByteArrayInputStream(png), png.length);
        }
        if ("/api/debug/file".equals(uri)) {
            // Download any file the app can read, e.g. /system/app/*.odex for reverse engineering
            java.io.File file = new java.io.File(String.valueOf(params.get("path")));
            if (!file.isFile() || !file.canRead()) {
                return notFound();
            }
            try {
                return newFixedLengthResponse(Response.Status.OK, "application/octet-stream",
                        new java.io.FileInputStream(file), file.length());
            } catch (java.io.FileNotFoundException e) {
                return notFound();
            }
        }
        if ("/api/debug/resources".equals(uri)) {
            return newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT,
                    SystemResources.list(intParam(params, "from", 0x01080000), intParam(params, "count", 0x1000)));
        }
        if ("/api/debug/drawable".equals(uri)) {
            byte[] png = SystemResources.renderPng(intParam(params, "id", 0), intParam(params, "state", 0));
            return png == null ? notFound() : newFixedLengthResponse(Response.Status.OK, "image/png",
                    new java.io.ByteArrayInputStream(png), png.length);
        }
        if ("/api/debug/blob".equals(uri)) {
            // Raw throughput test: stream `size` zero bytes
            int size = intParam(params, "size", 1000000);
            return newFixedLengthResponse(Response.Status.OK, "application/octet-stream",
                    new java.io.ByteArrayInputStream(new byte[size]), size);
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found: " + uri);
    }

    private static int intParam(java.util.Map<String, String> params, String name, int fallback) {
        try {
            String value = params.get(name);
            if (value == null) {
                return fallback;
            }
            return value.startsWith("0x") ? (int) Long.parseLong(value.substring(2), 16) : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private Response photo(long id, String kind) throws JSONException, java.io.IOException {
        if (kind == null) {
            JSONObject details = photos.details(id);
            return details == null ? notFound() : json(details);
        }
        Response response;
        if ("full".equals(kind) || "raw".equals(kind)) {
            java.io.File file = photos.file(id, "raw".equals(kind) ? "ARW" : "JPG");
            if (file == null) {
                return notFound();
            }
            response = newFixedLengthResponse(Response.Status.OK,
                    "raw".equals(kind) ? "image/x-sony-arw" : "image/jpeg",
                    new java.io.FileInputStream(file), file.length());
            response.addHeader("Content-Disposition", "inline; filename=\"" + file.getName() + "\"");
        } else {
            byte[] jpeg = "thumb".equals(kind) ? photos.thumbnail(id)
                    : "micro".equals(kind) ? photos.micro(id)
                    : "small".equals(kind) ? photos.small(id)
                    : photos.preview(id);
            if (jpeg == null) {
                return notFound();
            }
            response = newFixedLengthResponse(Response.Status.OK, "image/jpeg",
                    new java.io.ByteArrayInputStream(jpeg), jpeg.length);
        }
        // A photo's content never changes for a given id
        response.addHeader("Cache-Control", "max-age=86400");
        response.addHeader("Access-Control-Allow-Origin", "*");
        return response;
    }

    /** Request body of a POST with a JSON (non-form) content type. */
    private static String body(IHTTPSession session) throws java.io.IOException, ResponseException {
        java.util.Map<String, String> files = new java.util.HashMap<String, String>();
        session.parseBody(files);
        String body = files.get("postData");
        return body == null ? "{}" : body;
    }

    private static Response notFound() {
        return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
    }

    private Response liveViewStream() {
        if (!liveView.isRunning()) {
            return unavailable();
        }
        Response response = newChunkedResponse(Response.Status.OK, MjpegStream.CONTENT_TYPE, new MjpegStream(liveView));
        response.addHeader("Cache-Control", "no-cache, no-store");
        response.addHeader("Access-Control-Allow-Origin", "*");
        return response;
    }

    private Response liveViewFrame() throws InterruptedException {
        if (!liveView.isRunning()) {
            return unavailable();
        }
        liveView.addClient();
        LiveView.Frame frame;
        try {
            frame = liveView.awaitFrame(0, 3000);
        } finally {
            liveView.removeClient();
        }
        if (frame == null) {
            return unavailable();
        }
        Response response = newFixedLengthResponse(Response.Status.OK, "image/jpeg",
                new java.io.ByteArrayInputStream(frame.jpeg), frame.jpeg.length);
        response.addHeader("Cache-Control", "no-cache, no-store");
        response.addHeader("Access-Control-Allow-Origin", "*");
        return response;
    }

    private static Response unavailable() {
        return newFixedLengthResponse(Response.Status.SERVICE_UNAVAILABLE, MIME_PLAINTEXT, "Live view not running");
    }

    private static JSONObject info() throws JSONException {
        DeviceInfo device = DeviceInfo.getInstance();
        JSONObject json = new JSONObject();
        json.put("app", "ilce-remote");
        json.put("appVersion", BuildConfig.VERSION_NAME);
        json.put("model", device.getModel());
        json.put("productCode", device.getProductCode());
        json.put("firmware", device.getFirmwareVersion());
        json.put("pmcaApi", device.getApiVersion());
        json.put("android", device.getAndroidVersion());
        return json;
    }

    private static Response json(JSONObject json) {
        Response response = newFixedLengthResponse(Response.Status.OK, "application/json", json.toString());
        response.addHeader("Access-Control-Allow-Origin", "*");
        return response;
    }
}

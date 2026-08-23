"""
VitaLens -- AI-Powered Contactless Wellness Monitoring
Flask backend (Section 12: Tech Stack -> Backend).

Run:
    python app.py

Then open http://localhost:5000 in a browser.
"""

from flask import Flask, jsonify, render_template, Response
from vitalens_core.camera import VitaLensProcessor

app = Flask(__name__)
processor = VitaLensProcessor(camera_index=0)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    """Polled every ~1s by the frontend for live signal values."""
    state = processor.get_state()
    # history can get large; only send the tail for the live chart
    state["history"] = state["history"][-120:]
    return jsonify(state)


@app.route("/api/calibrate/restart", methods=["POST"])
def api_restart_calibration():
    processor.restart_calibration()
    return jsonify({"ok": True})


def _mjpeg_generator():
    while True:
        frame_bytes = processor.get_jpeg_frame()
        if frame_bytes is None:
            continue
        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n")


@app.route("/video_feed")
def video_feed():
    return Response(_mjpeg_generator(), mimetype="multipart/x-mixed-replace; boundary=frame")


if __name__ == "__main__":
    processor.start()
    try:
        app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
    finally:
        processor.stop()

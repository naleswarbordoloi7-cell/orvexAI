from datetime import datetime
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent.parent
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CORS(app, resources={r"/api/*": {"origins": "*"}})

stats = {
    "total_scans": 0,
    "high_risk_count": 0,
    "medium_risk_count": 0,
    "low_risk_count": 0,
    "objects_detected": 0,
    "object_detection_pct": 0,
    "alert_queue_size": 0,
    "high_risk_pct": 0,
    "medium_risk_pct": 0,
    "low_risk_pct": 0,
}

last_scan = {"objects": []}
alerts = []

CAMERAS = [
    {
        "id": "CAM-01",
        "location": "Main Entrance",
        "status": "ONLINE",
        "fps": 24,
        "resolution": "1080p"
    },
    {
        "id": "CAM-02",
        "location": "Warehouse",
        "status": "ONLINE",
        "fps": 18,
        "resolution": "720p"
    },
    {
        "id": "CAM-03",
        "location": "Parking Lot",
        "status": "ONLINE",
        "fps": 20,
        "resolution": "1080p"
    }
]

ZONES = [
    {"name": "Zone-A", "level": "HIGH", "risk": 88},
    {"name": "Zone-B", "level": "MEDIUM", "risk": 56},
    {"name": "Zone-C", "level": "LOW", "risk": 22},
]


def _calculate_percentages():
    total = max(stats["total_scans"], 1)
    stats["high_risk_pct"] = round(stats["high_risk_count"] / total * 100)
    stats["medium_risk_pct"] = round(stats["medium_risk_count"] / total * 100)
    stats["low_risk_pct"] = round(stats["low_risk_count"] / total * 100)
    stats["object_detection_pct"] = min(100, round(stats["objects_detected"] / max(total * 2, 1) * 100))
    stats["alert_queue_size"] = len(alerts)


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"})


@app.route("/api/scan", methods=["GET", "POST"])
def scan_endpoint():
    if request.method == "GET":
        return jsonify({"last_scan": last_scan})

    payload = request.get_json(silent=True) or {}
    objects = payload.get("objects") if isinstance(payload.get("objects"), list) else []
    last_scan["objects"] = objects
    stats["total_scans"] += 1
    stats["objects_detected"] += len(objects)

    high = sum(1 for item in objects if str(item.get("level", "")).upper() == "HIGH")
    medium = sum(1 for item in objects if str(item.get("level", "")).upper() == "MEDIUM")
    low = sum(1 for item in objects if str(item.get("level", "")).upper() == "LOW")

    stats["high_risk_count"] += high
    stats["medium_risk_count"] += medium
    stats["low_risk_count"] += low

    for item in objects:
        alerts.insert(0, {
            "id": item.get("id", "UNKNOWN"),
            "behavior": item.get("behavior", "Unknown"),
            "zone": item.get("zone", "Unknown"),
            "risk": item.get("risk", 0),
            "level": item.get("level", "LOW"),
            "timestamp": datetime.utcnow().isoformat() + "Z"
        })

    alerts[:] = alerts[:50]
    _calculate_percentages()

    return jsonify({"status": "ok", "updated": len(objects)})


@app.route("/api/stats", methods=["GET"])
def stats_endpoint():
    _calculate_percentages()
    return jsonify(stats)


@app.route("/api/cameras", methods=["GET"])
def cameras_endpoint():
    return jsonify({"cameras": CAMERAS})


@app.route("/api/zones", methods=["GET"])
def zones_endpoint():
    return jsonify({"zones": ZONES})


@app.route("/api/alerts", methods=["GET"])
def alerts_endpoint():
    limit = request.args.get("limit", type=int) or 15
    return jsonify({"alerts": alerts[:limit]})


@app.route("/", methods=["GET"])
def serve_index():
    return app.send_static_file("index.html")


@app.route("/<path:path>", methods=["GET"])
def serve_static(path):
    return app.send_static_file(path)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)

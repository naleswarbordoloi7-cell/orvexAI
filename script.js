// ============================================================
//   Orvex AI — Frontend ↔ Backend Connection
//   Backend: http://127.0.0.1:5000
// ============================================================

const API = "http://127.0.0.1:5000";
fetch('http://127.0.0.1:5000/api/scan')
  .then(res => res.json())
  .then(data => console.log(data));

let systemRunning = false;
let detectionLoopRunning = false;
let scanInterval;
let statsInterval;
let cocoModel = null;

// ─── BACKEND STATUS CHECK ───────────────────────────────────
async function checkBackend() {
    const dot  = document.getElementById("backendDot");
    const text = document.getElementById("backendStatus");
    try {
        const res = await fetch(`${API}/api/health`);
        if (res.ok) {
            if (dot)  { dot.style.background = "#10b981"; dot.title = "Backend Online"; }
            if (text) text.innerText = "Backend: ONLINE";
            return true;
        }
    } catch {
        if (dot)  { dot.style.background = "#ef4444"; dot.title = "Backend Offline"; }
        if (text) text.innerText = "Backend: OFFLINE";
        addLog("⚠️ Cannot reach backend at " + API);
        return false;
    }
}

// ─── START / STOP ────────────────────────────────────────────
async function startSystem() {
    if (systemRunning) return;
    const ok = await checkBackend();
    if (!ok) { addLog("🔴 Start failed — backend is offline."); return; }

    if (!cocoModel) {
        addLog("⏳ Loading COCO-SSD Model (TensorFlow.js)...");
        try {
            cocoModel = await cocoSsd.load();
            addLog("✅ COCO-SSD Model loaded successfully!");
        } catch(err) {
            addLog("❌ Model load failed: " + err.message);
            return;
        }
    }

    systemRunning = true;
    detectionLoopRunning = true;
    document.getElementById("video-wrapper")?.classList.add("system-active");

    detectFrame(); 
    statsInterval = setInterval(fetchStats, 4000);

    fetchStats();
    fetchCameras();
    fetchZones();
    // fetchAlerts(); // Removed to prevent duplicate logs on load since we are now real-time
    addLog("🟢 System started — real-time detection active.");
}

function stopSystem() {
    systemRunning = false;
    detectionLoopRunning = false;
    clearInterval(scanInterval);
    clearInterval(statsInterval);
    document.getElementById("video-wrapper")?.classList.remove("system-active");
    
    // Clear canvas
    const canvas = document.getElementById("detectionCanvas");
    if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    updateUI("SYSTEM OFF", 0, "-", "-", "low", true);
    addLog("🔴 System stopped.");
}

// ─── REAL-TIME TFJS DETECTION ──────────────────────────────────
async function detectFrame() {
    if (!detectionLoopRunning || !cocoModel) return;
    
    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('detectionCanvas');
    
    if (!video || !canvas || video.paused || video.ended || video.readyState < 2) {
        requestAnimationFrame(detectFrame);
        return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    const predictions = await cocoModel.detect(video);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let topRisk = 0;
    let topPred = null;

    predictions.forEach(pred => {
        // Draw Box
        ctx.beginPath();
        ctx.rect(pred.bbox[0], pred.bbox[1], pred.bbox[2], pred.bbox[3]);
        ctx.lineWidth = 4;
        ctx.strokeStyle = pred.class === 'person' ? '#ef4444' : '#10b981';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.stroke();
        
        // Draw Label
        ctx.font = '24px sans-serif';
        const text = `${pred.class.toUpperCase()} (${Math.round(pred.score * 100)}%)`;
        const textWidth = ctx.measureText(text).width;
        ctx.fillRect(pred.bbox[0], pred.bbox[1] - 30, textWidth + 10, 30);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, pred.bbox[0] + 5, pred.bbox[1] - 8);
        
        if (pred.class === 'person') {
            const risk = 40 + Math.round(pred.score * 50); // 40-90 fake risk
            if (risk > topRisk) {
                topRisk = risk;
                topPred = pred;
            }
        }
    });

    if (topPred) {
        const level = topRisk > 80 ? "high" : topRisk > 60 ? "medium" : "low";
        const zone = "Zone-A (Active)";
        const trackId = "TRK-" + Math.floor(1000 + Math.random() * 9000); 
        
        updateUI("Movement", topRisk, zone, trackId, level, false);
        updateObjectInfo("Person", new Date().toISOString());
        
        if (level === "high" && Math.random() < 0.01) { // 1% chance per frame to log alert so it doesn't flood
            addLog(`🚨 HIGH → ${trackId} | Movement | ${zone} | Risk ${topRisk}`);
            playAlarm();
        }

        // Sync to backend periodically (every ~2 seconds)
        if (!window.__lastSync || Date.now() - window.__lastSync > 2000) {
            window.__lastSync = Date.now();
            fetch(`${API}/api/scan`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    objects: [{
                        id: trackId, behavior: "Movement", object: topPred.class,
                        zone, risk: topRisk, level: level.toUpperCase()
                    }]
                })
            }).catch(e => console.log("Backend sync failed:", e));
        }

    } else {
        updateUI("Scanning...", 0, "-", "-", "low", false);
        updateObjectInfo("NONE", "-");
        
        if (!window.__lastSync || Date.now() - window.__lastSync > 2000) {
            window.__lastSync = Date.now();
            fetch(`${API}/api/scan`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ objects: [] })
            }).catch(e => console.log("Backend sync failed:", e));
        }
    }

    requestAnimationFrame(detectFrame);
}

// ─── FETCH: STATS ─────────────────────────────────────────────
async function fetchStats() {
    try {
        const res  = await fetch(`${API}/api/stats`);
        const s    = await res.json();
        setText("statTotal",     s.total_scans);
        setText("statHigh",      s.high_risk_count  + " (" + s.high_risk_pct   + "%)");
        setText("statMedium",    s.medium_risk_count + " (" + s.medium_risk_pct + "%)");
        setText("statLow",       s.low_risk_count    + " (" + s.low_risk_pct    + "%)");
        setText("statObjects",   s.objects_detected  + " (" + s.object_detection_pct + "%)");
        setText("statAlertQueue",s.alert_queue_size);
    } catch {}
}

// ─── FETCH: CAMERAS ───────────────────────────────────────────
async function fetchCameras() {
    try {
        const res  = await fetch(`${API}/api/cameras`);
        const json = await res.json();
        const box  = document.getElementById("cameraList");
        if (!box) return;
        box.innerHTML = "";
        json.cameras.forEach(cam => {
            const color = cam.status === "ONLINE" ? "#10b981" : "#ef4444";
            box.innerHTML += `
              <div class="cam-item">
                <span style="color:${color}">● ${cam.id}</span>
                <span>${cam.location}</span>
                <span style="color:${color}">${cam.status}</span>
                <span>${cam.fps > 0 ? cam.fps + "fps | " + cam.resolution : "—"}</span>
              </div>`;
        });
    } catch {}
}

// ─── FETCH: ZONES ─────────────────────────────────────────────
async function fetchZones() {
    try {
        const res  = await fetch(`${API}/api/zones`);
        const json = await res.json();
        const box  = document.getElementById("zoneList");
        if (!box) return;
        box.innerHTML = "";
        json.zones.forEach(z => {
            const color = z.level === "HIGH" ? "#ef4444" : z.level === "MEDIUM" ? "#f59e0b" : "#10b981";
            box.innerHTML += `
              <div class="zone-item">
                <span>${z.name}</span>
                <span style="color:${color};font-weight:700">${z.level}</span>
                <span style="color:${color}">Risk: ${z.risk}</span>
              </div>`;
        });
    } catch {}
}

// ─── FETCH: ALERT HISTORY ─────────────────────────────────────
async function fetchAlerts() {
    try {
        const res  = await fetch(`${API}/api/alerts?limit=15`);
        const json = await res.json();
        const box  = document.getElementById("logBox");
        if (!box || json.alerts.length === 0) return;
        // Prepend history on first load
        json.alerts.reverse().forEach(a => {
            const icon = a.level === "HIGH" ? "🚨" : "⚠️";
            prependLog(`${icon} [${a.timestamp}] ${a.id} | ${a.behavior} | ${a.zone} | Risk ${a.risk}`);
        });
    } catch {}
}

// ─── UI HELPERS ───────────────────────────────────────────────
function updateUI(behavior, risk, zone, id, level, isOff) {
    setText("behavior", behavior);
    setText("risk",     isOff ? "-" : risk + "%");
    setText("zone",     zone);
    setText("trackId",  isOff ? "-" : "#" + id);

    const alertText = document.getElementById("alertText");
    const statusBox = document.getElementById("statusBox");
    if (!alertText || !statusBox) return;

    if (isOff) {
        alertText.innerText  = "SYSTEM OFF";
        alertText.style.color = "#64748b";
        alertText.style.textShadow = "none";
        statusBox.className  = "stat-box";
        return;
    }
    if (level === "high") {
        alertText.innerText  = "🚨 HIGH ALERT";
        alertText.style.color = "#ef4444";
        alertText.style.textShadow = "0 0 10px rgba(239,68,68,0.5)";
        statusBox.className  = "stat-box alert-high";
    } else if (level === "medium") {
        alertText.innerText  = "⚠️ STANDBY";
        alertText.style.color = "#f59e0b";
        alertText.style.textShadow = "0 0 10px rgba(245,158,11,0.4)";
        statusBox.className  = "stat-box alert-medium";
    } else {
        alertText.innerText  = "✅ SYSTEM NORMAL";
        alertText.style.color = "#10b981";
        alertText.style.textShadow = "0 0 10px rgba(16,185,129,0.4)";
        statusBox.className  = "stat-box alert-low";
    }
}

function updateObjectInfo(obj, dt) {
    setText("detectedObject", obj !== "NONE" ? "⚠️ " + obj : "None");
    setText("lastSeen", dt ? dt.split("T")[1] : "-");
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
}

function addLog(message) {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;
    const p = document.createElement("p");
    p.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    logBox.prepend(p);
    // Keep max 40 entries
    while (logBox.children.length > 40) logBox.removeChild(logBox.lastChild);
}

function prependLog(message) {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;
    const p = document.createElement("p");
    p.style.opacity = "0.6";
    p.innerText = message;
    logBox.prepend(p);
}

// ─── ALARM ────────────────────────────────────────────────────
function playAlarm() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = "square";
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
    } catch {}
}

// ─── MEDIA SUPPORT ────────────────────────────────────────────
async function startWebcam() {
    const videoObj = document.getElementById("cameraFeed");
    if (!videoObj) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        // If there was a previous file URL object, we don't necessarily need to clear it unless it was a blob URL, but playing safe.
        if (videoObj.src && videoObj.src.startsWith('blob:')) {
            URL.revokeObjectURL(videoObj.src);
        }
        videoObj.src = "";
        videoObj.srcObject = stream;
        videoObj.play();
        addLog("🎥 Live webcam feed started.");
    } catch (err) {
        addLog("❌ Webcam error: " + err.message);
        alert("Could not access webcam. Please allow permissions.");
    }
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const videoObj = document.getElementById("cameraFeed");
    const fileURL = URL.createObjectURL(file);

    // Stop current webcam stream if any
    if (videoObj.srcObject) {
        videoObj.srcObject.getTracks().forEach(track => track.stop());
        videoObj.srcObject = null;
    }
    
    videoObj.src = fileURL;
    videoObj.load();
    videoObj.play();
    addLog(`📁 Uploaded custom video: ${file.name}`);
}

// ─── INIT ─────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    checkBackend();
    setInterval(checkBackend, 10000);     // re-check every 10s
    console.log("Orvex AI — Frontend Connected to Backend");
});

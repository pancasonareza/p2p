const $ = id => document.getElementById(id);

const status = $("status"),
  localSDP = $("localSDP"),
  remoteSDP = $("remoteSDP"),
  chat = $("chatBox"),
  msg = $("msgInput"),
  send = $("btnSend");

const peerName = $("peerName");
const GAS = "https://script.google.com/macros/s/AKfycbzdpwTrqSI9TXMQ0TUNRcnoxy3LylrgzGIC4vmlFXLt-wc3g34jsf6BDHNtqREiCD-J/exec";

const peers = new Map();
let active = null;
let currentRoomId = null; 
let pollingInterval = null; 

// Perbaikan konfigurasi server STUN Google yang benar
const cfg = {
  iceServers: [
    { urls: "stun:://google.com" },
    { urls: "stun:://google.com" }
  ]
};

const id = () => "p_" + Math.random().toString(36).slice(2, 8);

async function api(action, data = {}) {
  try {
    if (action === "list") {
      const r = await fetch(GAS, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      return await r.json();
    }

    await fetch(GAS, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        ...data
      })
    });
    return { success: true };
  } catch (error) {
    console.error("API Error:", error);
    return { success: false };
  }
}

function log(t, c = "sys") {
  let d = document.createElement("div");
  d.className = "msg " + c;
  d.textContent = t;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function draw() {
  send.disabled = !active || peers.get(active)?.dc?.readyState !== "open";
}

// Perbaikan konflik variabel id -> dialihkan ke peerId
function dc(peerId) {
  let p = peers.get(peerId);

  p.dc.onopen = () => {
    if (!active) active = peerId;
    peerName.textContent = peerId;
    status.textContent = "Online";
    draw();
    
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      log("Koneksi P2P sukses. Polling server dinonaktifkan.", "sys");
    }
  };

  p.dc.onmessage = e => log(e.data, "peer");

  p.dc.onclose = () => {
    peers.delete(peerId);
    if (active == peerId) active = [...peers.keys()][0] || null;
    status.textContent = "Terputus";
    draw();
  };
}

function pc(peerId) {
  let p = peers.get(peerId);

  p.pc.onicegatheringstatechange = async () => {
    if (p.pc.iceGatheringState === "complete") {
      const type = p.pc.localDescription.type;
      const data = JSON.stringify({
        id: peerId,
        type: type,
        sdp: p.pc.localDescription
      });

      localSDP.value = data;
      await api("save", { text: data });
      log(`${type.toUpperCase()} dikirim ke server cloud otomatis.`);
    }
  };

  p.pc.onicecandidate = null; 
}

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);

  log("Mencari sinyal masuk dari server (Auto-polling aktif)...");
  
  pollingInterval = setInterval(async () => {
    const list = await api("list");
    if (!list || !Array.isArray(list)) return;

    for (const item of list) {
      try {
        const rawData = item.text || item; 
        const parsed = JSON.parse(rawData);

        if (parsed.id === currentRoomId) {
          const remoteType = parsed.type;
          const currentPeer = peers.get(currentRoomId);

          if (remoteType === "answer" && currentPeer && currentPeer.pc.signalingState === "have-local-offer") {
            remoteSDP.value = JSON.stringify(parsed);
            await currentPeer.pc.setRemoteDescription(parsed.sdp);
            log("Sinyal balasan (Answer) terdeteksi otomatis! Menghubungkan...");
          } 
          else if (remoteType === "offer" && !currentPeer) {
            remoteSDP.value = JSON.stringify(parsed);
            log("Sinyal undangan (Offer) terdeteksi otomatis! Memproses balasan...");
            await prosesRemoteSDP(parsed);
          }
        }
      } catch (e) {
        // Abaikan entri data non-JSON
      }
    }
  }, 2000); 
}

async function prosesRemoteSDP(parsedData) {
  let { id: peerId, sdp } = parsedData;
  let p = peers.get(peerId);

  if (!p) {
    p = {
      pc: new RTCPeerConnection(cfg),
      dc: null
    };
    peers.set(peerId, p);
    pc(peerId);

    p.pc.ondatachannel = e => {
      p.dc = e.channel;
      dc(peerId);
    };
  }

  if (sdp.type === "offer") {
    await p.pc.setRemoteDescription(sdp);
    let ans = await p.pc.createAnswer();
    await p.pc.setLocalDescription(ans);
    log("Membuat sandi balasan (Answer)...");
  } else {
    await p.pc.setRemoteDescription(sdp);
  }
  remoteSDP.value = "";
}

$("btnOffer").onclick = async () => {
  let pid = id();
  currentRoomId = pid; 

  let peer = {
    pc: new RTCPeerConnection(cfg),
    dc: null
  };

  peer.dc = peer.pc.createDataChannel("chat");
  peers.set(pid, peer);

  pc(pid);
  dc(pid);

  let offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);

  showToast(`Room ${pid} Berhasil Dibuat!`);
  log(`Room dibuat dengan ID: ${pid}. Menunggu teman bergabung...`);
  
  $("connectionBox").classList.add("hidden"); 
  startPolling();
};

$("btnAnswer").onclick = async () => {
  try {
    if (!remoteSDP.value.trim()) {
      remoteSDP.value = await navigator.clipboard.readText();
    }

    let parsed = JSON.parse(remoteSDP.value);
    currentRoomId = parsed.id; 

    await prosesRemoteSDP(parsed);
    startPolling();
  } catch (e) {
    log("Kode tidak valid!");
  }
};

$("btnSend").onclick = () => {
  if (!active) return;
  let p = peers.get(active);

  if (p && p.dc && p.dc.readyState == "open" && msg.value) {
    p.dc.send(msg.value);
    log(msg.value, "me");
    msg.value = "";
  }
};

msg.onkeypress = e => {
  if (e.key === "Enter") $("btnSend").click();
};

const btnCopy = $("btnCopy");
if (btnCopy) {
  btnCopy.onclick = async () => {
    if (!localSDP.value) return;
    localSDP.focus();
    localSDP.select();
    try {
      await navigator.clipboard.writeText(localSDP.value);
    } catch (e) {
      document.execCommand("copy");
    }
    log("Kode disalin ke clipboard");
  };
}

const btnSetting = $("btnSetting");
if (btnSetting) {
  btnSetting.onclick = () => {
    $("connectionBox").classList.toggle("hidden");
  };
}

function showToast(message) {
  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000);
  }
}
      return await r.json();
    }

    // Mode no-cors untuk menyimpan data
    await fetch(GAS, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action,
        ...data
      })
    });
    return { success: true };
  } catch (error) {
    console.error("API Error:", error);
    return { success: false };
  }
}

function log(t, c = "sys") {
  let d = document.createElement("div");
  d.className = "msg " + c;
  d.textContent = t;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function draw() {
  send.disabled = !active || peers.get(active)?.dc?.readyState !== "open";
}

function dc(id) {
  let p = peers.get(id);

  p.dc.onopen = () => {
    if (!active) active = id;
    peerName.textContent = id;
    status.textContent = "Online";
    draw();
    
    // Hentikan fungsi polling jika koneksi P2P antar browser sudah terhubung sukses
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      log("Koneksi P2P sukses. Polling server dinonaktifkan.", "sys");
    }
  };

  p.dc.onmessage = e => log(e.data, "peer");

  p.dc.onclose = () => {
    peers.delete(id);
    if (active == id) active = [...peers.keys()][0];
    status.textContent = "Terputus";
    draw();
  };
}

function pc(id) {
  let p = peers.get(id);

  // Menunggu hingga browser selesai mengumpulkan rute kandidat ICE (ICE gathering complete)
  p.pc.onicegatheringstatechange = async () => {
    if (p.pc.iceGatheringState === "complete") {
      const type = p.pc.localDescription.type;
      const data = JSON.stringify({
        id: id,
        type: type,
        sdp: p.pc.localDescription
      });

      localSDP.value = data;

      // Kirim SDP matang ke database cloud GAS secara otomatis
      await api("save", { text: data });
      log(`${type.toUpperCase()} dikirim ke server cloud otomatis.`);
    }
  };

  p.pc.onicecandidate = null; // Menghapus fungsi bawaan lama agar tidak duplikasi data
}

// FUNGSI UTAMA POLLING: Mengecek pesan baru dari database GAS secara berkala
function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);

  log("Mencari sinyal masuk dari server (Auto-polling aktif)...");
  
  pollingInterval = setInterval(async () => {
    const list = await api("list");
    if (!list || !Array.isArray(list)) return;

    // Filter mencari data JSON yang dikirim oleh teman yang memiliki ID room yang sama
    for (const item of list) {
      try {
        const rawData = item.text || item; // Sesuaikan dengan struktur return JSON dari script GAS Anda
        const parsed = JSON.parse(rawData);

        // Jika ID room cocok dengan room saat ini
        if (parsed.id === currentRoomId) {
          const remoteType = parsed.type;
          
          // Ambil status koneksi lokal saat ini
          const currentPeer = peers.get(currentRoomId);

          // KONDISI 1: Kita adalah Pembuat Room (Offer), lalu mendeteksi ada Answer masuk dari teman
          if (remoteType === "answer" && currentPeer && currentPeer.pc.signalingState === "have-local-offer") {
            remoteSDP.value = JSON.stringify(parsed);
            await currentPeer.pc.setRemoteDescription(parsed.sdp);
            log("Sinyal balasan (Answer) terdeteksi otomatis! Menghubungkan...");
          } 
          
          // KONDISI 2: Kita adalah Penerima (Joiner), mendeteksi ada Offer masuk dari teman yang membuat room
          else if (remoteType === "offer" && !currentPeer) {
            remoteSDP.value = JSON.stringify(parsed);
            log("Sinyal undangan (Offer) terdeteksi otomatis! Memproses balasan...");
            
            // Eksekusi otomatis membuat balasan tanpa klik tombol
            await prosesRemoteSDP(parsed);
          }
        }
      } catch (e) {
        // Abaikan baris database yang formatnya bukan JSON sdp chat
      }
    }
  }, 2000); // Mengecek server cloud setiap 2000ms (2 detik)
}

// Fungsi pembantu untuk memproses SDP yang masuk dari polling atau input manual
async function prosesRemoteSDP(parsedData) {
  let { id: peerId, sdp } = parsedData;
  let p = peers.get(peerId);

  if (!p) {
    p = {
      pc: new RTCPeerConnection(cfg),
      dc: null
    };
    peers.set(peerId, p);
    pc(peerId);

    p.pc.ondatachannel = e => {
      p.dc = e.channel;
      dc(peerId);
    };
  }

  if (sdp.type === "offer") {
    await p.pc.setRemoteDescription(sdp);
    let ans = await p.pc.createAnswer();
    await p.pc.setLocalDescription(ans);
    log("Membuat sandi balasan (Answer)...");
  } else {
    await p.pc.setRemoteDescription(sdp);
  }
  remoteSDP.value = "";
}

// TOMBOL: BUAT ROOM CHAT BARU (SISI INITIATOR / OFFER)
$("btnOffer").onclick = async () => {
  let pid = id();
  currentRoomId = pid; 

  let peer = {
    pc: new RTCPeerConnection(cfg),
    dc: null
  };

  peer.dc = peer.pc.createDataChannel("chat");
  peers.set(pid, peer);

  pc(pid);
  dc(pid);

  let offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);

  // --- INDIKATOR BARU ---
  showToast(`Room ${pid} Berhasil Dibuat!`);
  log(`Room dibuat dengan ID: ${pid}. Menunggu teman bergabung...`);
  
  // Otomatis menutup panel pengaturan setelah room dibuat agar user bisa melihat log chat
  $("connectionBox").classList.add("hidden"); 
  
  startPolling();
};


// TOMBOL: BERGABUNG DENGAN ROOM TEMAN SECARA MANUAL (SISI JOINER / ANSWER)
$("btnAnswer").onclick = async () => {
  try {
    if (!remoteSDP.value.trim()) {
      remoteSDP.value = await navigator.clipboard.readText();
    }

    let parsed = JSON.parse(remoteSDP.value);
    currentRoomId = parsed.id; // Kunci ID agar mengikuti room pembuat

    await prosesRemoteSDP(parsed);
    
    // Nyalakan polling untuk memantau kelanjutan sinyal di room ini
    startPolling();
  } catch (e) {
    log("Kode tidak valid!");
  }
};

$("btnSend").onclick = () => {
  if (!active) return;
  let p = peers.get(active);

  if (p && p.dc && p.dc.readyState == "open" && msg.value) {
    p.dc.send(msg.value);
    log(msg.value, "me");
    msg.value = "";
  }
};

msg.onkeypress = e => {
  if (e.key === "Enter") $("btnSend").click();
};

const btnCopy = $("btnCopy");
if (btnCopy) {
  btnCopy.onclick = async () => {
    if (!localSDP.value) return;
    localSDP.focus();
    localSDP.select();
    try {
      await navigator.clipboard.writeText(localSDP.value);
    } catch (e) {
      document.execCommand("copy");
    }
    log("Kode disalin ke clipboard");
  };
}

const btnSetting = $("btnSetting");
if (btnSetting) {
  btnSetting.onclick = () => {
    $("connectionBox").classList.toggle("hidden");
  };
}

// Fungsi memunculkan notifikasi melayang (Toast) ala Telegram
function showToast(message) {
  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3000); // Hilang otomatis setelah 3 detik
  }
}


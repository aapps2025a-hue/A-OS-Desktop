const MINIMUM_RAM_GB = 3;

function detectedMemoryGb() {
  const testValue = new URLSearchParams(window.location.search).get("aosTestRam");
  const isLocalTest = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalTest && testValue !== null) {
    const parsed = Number(testValue);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const reported = Number(navigator.deviceMemory);
  return Number.isFinite(reported) && reported > 0 ? reported : null;
}

function formatMemory(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderBootFailure(memoryGb, loadError) {
  document.title = "A-OS Boot Error";
  document.documentElement.style.background = "#07111a";
  document.body.innerHTML = `
    <main class="aos-hardware-error" role="alert" aria-live="assertive">
      <section>
        <img src="./assets/icons/Error.png" alt="">
        <small>A-OS HARDWARE CHECK</small>
        <h1>A-OS cannot start</h1>
        <p>${loadError ? "The Desktop system files could not be loaded." : `This device reports ${formatMemory(memoryGb)} GB of RAM. A-OS Desktop requires at least ${MINIMUM_RAM_GB} GB to boot.`}</p>
        <dl>
          <div><dt>Required memory</dt><dd>${MINIMUM_RAM_GB} GB RAM</dd></div>
          <div><dt>Detected memory</dt><dd>${memoryGb === null ? "Not available" : `${formatMemory(memoryGb)} GB RAM`}</dd></div>
          <div><dt>Boot status</dt><dd>Stopped</dd></div>
        </dl>
        <button type="button" data-aos-recheck>Check hardware again</button>
      </section>
    </main>`;

  const style = document.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}body{margin:0;background:#07111a;color:#eef8fc;font-family:Inter,system-ui,sans-serif}
    .aos-hardware-error{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#07111a,#10293a)}
    .aos-hardware-error section{width:min(560px,100%);border:1px solid #ff6b6b66;border-radius:8px;background:#0d1b27;padding:30px;box-shadow:0 28px 90px #0009}
    .aos-hardware-error img{width:68px;height:68px;object-fit:contain;margin-bottom:16px}.aos-hardware-error small{display:block;color:#ff9d9d;font-size:11px;font-weight:900;letter-spacing:0}
    .aos-hardware-error h1{margin:5px 0 8px;font-size:30px}.aos-hardware-error p{margin:0;color:#b8c8d2;line-height:1.55}
    .aos-hardware-error dl{margin:24px 0;border-top:1px solid #ffffff18}.aos-hardware-error dl div{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #ffffff18;padding:12px 0}
    .aos-hardware-error dt{color:#8da3b2}.aos-hardware-error dd{margin:0;font-weight:850}.aos-hardware-error button{border:0;border-radius:6px;background:#55d6e4;color:#061018;padding:11px 15px;font-weight:900;cursor:pointer}
  `;
  document.head.appendChild(style);
  document.querySelector("[data-aos-recheck]").addEventListener("click", () => window.location.reload());
}

const memoryGb = detectedMemoryGb();
const blocked = memoryGb !== null && memoryGb < MINIMUM_RAM_GB;
window.AOS_HARDWARE_STATE = {minimumRamGb: MINIMUM_RAM_GB, memoryGb, blocked};

if (blocked) {
  renderBootFailure(memoryGb, false);
} else {
  import("./assets/index-D5wdOlTt-managed9.js").catch(() => renderBootFailure(memoryGb, true));
}

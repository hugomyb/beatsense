const form = {
  enabled: document.getElementById("enabled"),
  fieldsets: document.querySelectorAll("fieldset"),
};

function render(s) {
  form.enabled.checked = s.enabled;
  for (const name of ["show", "auto"]) {
    document.querySelector(`input[name="${name}"][value="${s[name]}"]`).checked = true;
  }
  form.fieldsets.forEach((f) => (f.disabled = !s.enabled));
}

async function save() {
  const settings = {
    enabled: form.enabled.checked,
    show: document.querySelector('input[name="show"]:checked').value,
    auto: document.querySelector('input[name="auto"]:checked').value,
  };
  await browser.storage.local.set({ settings });
  render(settings);
}

document.body.addEventListener("change", save);
loadSettings().then(render);

fetch("http://127.0.0.1:7843/health")
  .then((r) => r.json())
  .then((h) => {
    const footer = document.getElementById("server");
    footer.textContent = `Serveur connecté — prods dans ${h.dir}`;
    footer.dataset.state = "ok";
  })
  .catch(() => {
    const footer = document.getElementById("server");
    footer.textContent = "Serveur injoignable : relance le PC ou la commande d'installation";
    footer.dataset.state = "error";
  });

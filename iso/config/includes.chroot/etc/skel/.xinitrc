#!/bin/sh

xset s off
xset -dpms
xset s noblank
xsetroot -solid '#050607'

openbox-session &
rm -f /tmp/aos-browser-ready

until curl --silent --fail http://127.0.0.1:5000/ >/dev/null; do
  sleep 0.1
done

echo "AOS_LOCAL_SERVER_READY"

(
  while [ ! -f /tmp/aos-browser-ready ]; do
    sleep 0.25
  done
  echo "AOS_BROWSER_HTML_READY"
) &

chromium_gpu_flags=""
if cat \
  /sys/class/dmi/id/product_name \
  /sys/class/dmi/id/sys_vendor \
  /sys/class/dmi/id/board_vendor \
  2>/dev/null | grep -Eqi 'qemu|kvm'; then
  chromium_gpu_flags="--disable-gpu"
fi

while true; do
  chromium \
    $chromium_gpu_flags \
    --kiosk \
    --start-fullscreen \
    --app="http://127.0.0.1:5000/index.html?aosLiveIso=1" \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-logging \
    --log-level=3 \
    --disable-crash-reporter \
    --disable-domain-reliability \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-prompt-on-repost \
    --disable-search-engine-choice-screen \
    --disable-dev-shm-usage \
    --disable-translate \
    --disable-background-networking \
    --disable-component-update \
    --disable-sync \
    --disable-breakpad \
    --disable-features=Translate,MediaRouter,ChromeWhatsNewUI,SidePanelPinning,OptimizationHints,AutofillServerCommunication \
    --no-service-autorun \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --restore-last-session \
    --user-data-dir=/var/lib/aos/browser-profile \
    --disk-cache-dir=/var/lib/aos/browser-cache \
    >/dev/null 2>&1
  sleep 1
done

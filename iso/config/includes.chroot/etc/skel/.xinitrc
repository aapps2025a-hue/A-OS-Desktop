#!/bin/sh

xset s off
xset -dpms
xset s noblank

openbox-session &
nm-applet --indicator >/tmp/aos-network.log 2>&1 &
rm -f /tmp/aos-browser-ready
python3 /usr/local/lib/aos/server.py >/tmp/aos-server.log 2>&1 &

until curl --silent --fail http://127.0.0.1:5000/ >/dev/null; do
  sleep 0.25
done

echo "AOS_LOCAL_SERVER_READY"

(
  while [ ! -f /tmp/aos-browser-ready ]; do
    sleep 0.25
  done
  echo "AOS_BROWSER_HTML_READY"
) &

while true; do
  chromium \
    --kiosk \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-dev-shm-usage \
    --disable-translate \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --user-data-dir=/home/aos/.config/aos-chromium \
    "http://127.0.0.1:5000/index.html?aosLiveIso=1&aosTestRam=3"
  sleep 1
done

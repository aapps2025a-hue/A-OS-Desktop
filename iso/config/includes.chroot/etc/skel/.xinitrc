#!/bin/sh

xset s off
xset -dpms
xset s noblank

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

while true; do
  chromium \
    --kiosk \
    --no-first-run \
    --no-default-browser-check \
    --noerrdialogs \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --disable-translate \
    --disable-background-networking \
    --disable-component-update \
    --disable-sync \
    --disable-breakpad \
    --disable-features=Translate,MediaRouter \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --user-data-dir=/home/aos/.config/aos-chromium \
    "http://127.0.0.1:5000/index.html?aosLiveIso=1"
  sleep 1
done

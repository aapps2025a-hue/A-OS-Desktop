#!/bin/sh

xset s off
xset -dpms
xset s noblank

openbox-session &
nm-applet --indicator >/tmp/aos-network.log 2>&1 &
python3 /usr/local/lib/aos/server.py >/tmp/aos-server.log 2>&1 &

until curl --silent --fail http://127.0.0.1:5000/ >/dev/null; do
  sleep 0.25
done

echo "AOS_BOOT_READY" >/dev/ttyS0 2>/dev/null || true

while true; do
  chromium \
    --kiosk \
    --no-first-run \
    --disable-session-crashed-bubble \
    --disable-infobars \
    --autoplay-policy=no-user-gesture-required \
    --password-store=basic \
    --user-data-dir=/home/aos/.config/aos-chromium \
    "http://127.0.0.1:5000/?aosLiveIso=1"
  sleep 1
done

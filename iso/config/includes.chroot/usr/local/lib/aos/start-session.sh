#!/bin/sh

set -eu

until id aos >/dev/null 2>&1 && [ -f /home/aos/.xinitrc ]; do
  sleep 0.25
done

for group in audio bluetooth input netdev video; do
  getent group "$group" >/dev/null 2>&1 && usermod -a -G "$group" aos
done

chown -R aos:aos /home/aos
install -d -o aos -g aos -m 0700 /var/lib/aos/browser-profile /var/lib/aos/browser-cache
if [ -d /home/aos/.config/aos-runtime ] && [ ! -e /var/lib/aos/browser-profile/.aos-profile-migrated ]; then
  rsync -a /home/aos/.config/aos-runtime/ /var/lib/aos/browser-profile/ || true
  touch /var/lib/aos/browser-profile/.aos-profile-migrated
fi
chown -R aos:aos /var/lib/aos/browser-profile /var/lib/aos/browser-cache
cd /home/aos
exec runuser --login aos -- startx /home/aos/.xinitrc -- :0 vt7 -nolisten tcp

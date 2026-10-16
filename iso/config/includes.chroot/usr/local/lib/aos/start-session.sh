#!/bin/sh

set -eu

until id aos >/dev/null 2>&1 && [ -f /home/aos/.xinitrc ]; do
  sleep 0.25
done

chown -R aos:aos /home/aos
cd /home/aos
exec runuser --login aos -- startx /home/aos/.xinitrc -- :0 vt7 -nolisten tcp

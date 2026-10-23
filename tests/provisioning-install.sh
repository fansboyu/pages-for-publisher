#!/usr/bin/env bash
# Run only in a disposable Linux container. systemctl and ss are test shims.
set -eu
stage=/tmp/site-agent-aaaaaaaaaaaaaaaaaaaaaaaa
cp -R /payload "$stage"
chmod 0700 "$stage"
mkdir -p /srv/existing-business
printf 'preserve-existing-business\n' >/srv/existing-business/index.html
cat >/usr/local/bin/ss <<'SH'
#!/bin/sh
exit 0
SH
cat >/usr/local/bin/systemctl <<'SH'
#!/bin/sh
if [ "${FAIL_INSTALL:-0}" = 1 ] && [ "$1" = enable ] && [ "${3:-}" = site-agent.service ]; then exit 1; fi
exit 0
SH
chmod 0755 /usr/local/bin/ss /usr/local/bin/systemctl
(cd "$stage"; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
set +e
bash /scripts/install.sh
status=$?
set -e
test "$(cat /srv/existing-business/index.html)" = preserve-existing-business
test ! -e "$stage"
if [ "${FAIL_INSTALL:-0}" = 1 ]; then
 test "$status" != 0
 for path in /opt/site-control /etc/site-agent /var/lib/site-agent /var/lib/site-agent-caddy /etc/systemd/system/site-agent.service /etc/systemd/system/site-agent-caddy.service; do test ! -e "$path"; done
 if id site-agent >/dev/null 2>&1; then exit 1; fi
 if id site-caddy >/dev/null 2>&1; then exit 1; fi
 if getent group site-agent-web >/dev/null; then exit 1; fi
 echo 'PASS Linux installer failure cleans only new files, units and users; existing business preserved'
else
 test "$status" = 0
 test "$(stat -c %a /etc/site-agent/agent.json)" = 600
 test "$(stat -c %U /etc/site-agent/agent.json)" = site-agent
 runuser -u site-caddy -- test ! -r /etc/site-agent/agent.json
 runuser -u site-agent -- test ! -w /opt/site-control/agent/agent.mjs
 runuser -u site-agent -- /opt/site-control/bin/node --input-type=module -e 'await import("file:///opt/site-control/agent/agent.mjs")'
 runuser -u site-agent -- sh -c 'umask 0027; echo readable >/var/lib/site-agent/check.txt'
 runuser -u site-caddy -- test -r /var/lib/site-agent/check.txt
 grep -q '127.0.0.1:2019' /etc/site-agent/agent.json
 runuser -u site-caddy -- env XDG_DATA_HOME=/var/lib/site-agent-caddy/data XDG_CONFIG_HOME=/var/lib/site-agent-caddy/config /opt/site-control/bin/caddy run --resume --config /var/lib/site-agent-caddy/bootstrap.json >/tmp/caddy-test.log 2>&1 &
 caddy_pid=$!
 if ! timeout 25 runuser -u site-agent -- /opt/site-control/bin/node /opt/site-control/agent/wait-caddy.mjs /etc/site-agent/agent.json; then cat /tmp/caddy-test.log; exit 1; fi
 kill "$caddy_pid"
 wait "$caddy_pid" || true
 echo 'PASS Linux installer users, file modes, real Node runtime and Agent dependency imports; systemd is simulated'
fi

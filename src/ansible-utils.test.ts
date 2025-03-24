import t from "tap";

import { buildSetHostnameCommand, concatCommands, makeSetHostnameCommand } from "./ansible-utils";

t.test("buildSetHostnameCommand", async (t) => {
  t.test("default setHostnameCommand", async (t) => {
    t.equal(
      buildSetHostnameCommand({
        hostname: "foo",
      }),
      `command -v hostnamectl &>/dev/null && sudo hostnamectl set-hostname "foo"\necho "foo" | sudo tee /etc/hostname`,
    );
  });

  t.test("custom setHostnameCommand", async (t) => {
    t.equal(
      buildSetHostnameCommand({
        hostname: "foo",
        setHostnameCommand: "export HOSTNAME=$hostname",
      }),
      `export HOSTNAME=foo`,
    );
  });
});

t.test("makeSetHostnameCommand", async (t) => {
  t.test("no default hostname", (t) => {
    const cmd = makeSetHostnameCommand({
      defaultHostname: undefined,
    });

    t.equal(cmd, undefined);
    t.end();
  });

  t.test("setHostname = false", (t) => {
    const cmd = makeSetHostnameCommand({
      setHostname: false,
      defaultHostname: "foo",
    });

    t.equal(cmd, undefined);
    t.end();
  });

  t.test("setHostname = true", (t) => {
    const cmd = makeSetHostnameCommand({
      setHostname: true,
      defaultHostname: "foo",
    });

    cmd!.apply((cmd) => {
      t.equal(
        cmd,
        `command -v hostnamectl &>/dev/null && sudo hostnamectl set-hostname "foo"\necho "foo" | sudo tee /etc/hostname`,
      );
      t.end();
    });
  });

  t.test("setHostname = 'bar'", (t) => {
    const cmd = makeSetHostnameCommand({
      setHostname: "bar",
      defaultHostname: "foo",
    });

    cmd!.apply((cmd) => {
      t.equal(
        cmd,
        `command -v hostnamectl &>/dev/null && sudo hostnamectl set-hostname "bar"\necho "bar" | sudo tee /etc/hostname`,
      );
      t.end();
    });
  });

  t.test("with setHostnameCommand", (t) => {
    const cmd = makeSetHostnameCommand({
      setHostnameCommand: "export HOSTNAME=$hostname",
      defaultHostname: "foo",
    });

    cmd!.apply((cmd) => {
      t.equal(
        cmd,
        `export HOSTNAME=foo`,
      );
      t.end();
    });
  });
});

t.test("concatCommands", (t) => {
  const cmd = concatCommands([
    "echo a\n",
    "",
    "\n",
    undefined,
    "echo b\necho c",
    "echo d",
  ]);

  cmd.apply((cmd) => {
    t.equal(
      cmd,
      `echo a


echo b
echo c
echo d
`,
    );
    t.end();
  });
});

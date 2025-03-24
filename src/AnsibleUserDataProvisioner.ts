import { readFile } from "fs/promises";
import { gzipSync } from "zlib";

import * as pulumi from "@pulumi/pulumi";
import * as pulumistd from "@pulumi/std";
import {
  AnsibleProvisionerProps,
  bashBackoffRetryFunction,
  buildRunCommand,
  defaultRemotePath,
  makePlaybookOutput,
} from "@sapslaj/pulumi-ansible-provisioner";
import * as tar from "tar-stream";
import * as YAML from "yaml";

import { concatCommands, gatherRolesFiles, makeSetHostnameCommand } from "./ansible-utils";

export interface AnsibleUserDataProvisionerConfig extends Omit<AnsibleProvisionerProps, "connection"> {
  setHostname?: boolean | pulumi.Input<string>;
  setHostnameCommand?: pulumi.Input<string>;
}

export interface AnsibleUserDataProvisionerProps extends AnsibleUserDataProvisionerConfig {
  defaultHostname?: pulumi.Input<string>;
}

export function buildTarData(files: Record<string, string | Buffer>): Promise<string> {
  return new Promise((resolve, reject) => {
    const pack = tar.pack();
    const chunks: any[] = [];

    pack.on("data", (chunk) => chunks.push(chunk));
    pack.on("error", (err) => reject(err));
    pack.on("end", () => {
      resolve(gzipSync(Buffer.concat(chunks)).toString("base64"));
    });

    for (const [name, content] of Object.entries(files)) {
      pack.entry({
        name,
        mtime: new Date(0),
      }, content);
    }

    pack.finalize();
  });
}

export function buildTarExtractCommand({ remotePath, b64data }: { remotePath: string; b64data: string }) {
  return [
    `sudo mkdir -p "${remotePath}"\n`,
    `sudo chown -Rv "$USER:$USER" "${remotePath}"\n`,
    `echo -n '${b64data}' | base64 -d | tar -z -x -C "${remotePath}" -f -\n`,
  ].join("");
}

export class AnsibleUserDataProvisioner extends pulumi.ComponentResource {
  tarData: pulumi.Output<string>;
  userData: pulumi.Output<string>;

  constructor(name: string, props: AnsibleUserDataProvisionerProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:AnsibleUserDataProvisioner", name, {}, opts);

    const setHostnameCommand = makeSetHostnameCommand(props);

    const remotePath = props.remotePath ?? defaultRemotePath;
    const playbook = makePlaybookOutput(props as AnsibleProvisionerProps);

    this.tarData = pulumi.all({ playbook, requirements: props.requirements }).apply(
      async ({ playbook, requirements }) => {
        const rolesFilePaths = gatherRolesFiles(props.rolePaths ?? []);

        const files: Record<string, string | Buffer> = {};

        files["main.yml"] = YAML.stringify(playbook);

        if (requirements !== undefined && requirements !== null) {
          files["requirements.yml"] = YAML.stringify(requirements);
        }

        for (const [key, roleFile] of Object.entries(rolesFilePaths)) {
          files[key] = await readFile(roleFile.absoluteFileLocation);
        }

        return await buildTarData(files);
      },
    );

    const tarExtractCommand = pulumi.all({ tarData: this.tarData, remotePath }).apply(({ tarData, remotePath }) =>
      buildTarExtractCommand({ remotePath, b64data: tarData })
    );

    const runCommand = pulumi.all({ remotePath }).apply(({ remotePath }) =>
      buildRunCommand({
        remotePath,
        id: "main",
        withBackoff: false,
      })
    );

    this.userData = concatCommands([
      "#!/bin/bash\n",
      "set -euo pipefail\n",
      bashBackoffRetryFunction,
      props.ansibleInstallCommand ?? "",
      setHostnameCommand ?? "",
      tarExtractCommand,
      runCommand,
    ]);
  }

  userDataBase64(): pulumi.Output<string> {
    return pulumistd.base64encodeOutput({
      input: this.userData,
    }).result;
  }
}

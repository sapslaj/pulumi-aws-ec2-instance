import * as path from "path";
import { Dirent } from "fs";

import { walkSync } from "@nodesecure/fs-walk";
import * as pulumi from "@pulumi/pulumi";

export interface BuildSetHostnameCommandOpts {
  hostname: string;
  setHostnameCommand?: string;
}

export function buildSetHostnameCommand(opts: BuildSetHostnameCommandOpts): string {
  let { hostname, setHostnameCommand } = opts;

  if (!setHostnameCommand) {
    setHostnameCommand = [
      `command -v hostnamectl &>/dev/null && sudo hostnamectl set-hostname "$hostname"`,
      `echo "$hostname" | sudo tee /etc/hostname`,
    ].join("\n");
  }

  return setHostnameCommand.replaceAll("$hostname", hostname);
}

export interface MakeSetHostnameCommandProps {
  setHostname?: boolean | pulumi.Input<string>;
  setHostnameCommand?: pulumi.Input<string>;
  defaultHostname?: pulumi.Input<string>;
}

export function makeSetHostnameCommand(opts: MakeSetHostnameCommandProps): pulumi.Output<string> | undefined {
  if (!opts.defaultHostname || opts.setHostname === false) {
    return undefined;
  }

  const setHostnameCommand = opts.setHostnameCommand;
  let hostname: pulumi.Input<string>;

  if (opts.setHostname === true || opts.setHostname === undefined) {
    hostname = opts.defaultHostname;
  } else {
    hostname = opts.setHostname;
  }

  return pulumi.all({ hostname, setHostnameCommand }).apply(({ hostname, setHostnameCommand }) => {
    // i have no clue why TypeScript thinks these are `string | undefined`...
    return buildSetHostnameCommand({ hostname: hostname!, setHostnameCommand: setHostnameCommand! });
  });
}

export interface RoleFile extends Dirent {
  absoluteFileLocation: string;
}

export function gatherRolesFiles(rolePaths: string[]): Record<string, RoleFile> {
  const result: Record<string, RoleFile> = {};
  for (const rolePath of rolePaths) {
    const absoluteRolePath = path.normalize(rolePath);
    for (const [dirent, absoluteFileLocation] of walkSync(rolePath)) {
      if (!dirent.isFile() && !dirent.isSymbolicLink()) {
        continue;
      }
      const key = absoluteFileLocation.replace(path.dirname(absoluteRolePath) + "/", "");
      const roleFile: Partial<RoleFile> = dirent;
      roleFile.absoluteFileLocation = absoluteFileLocation;
      result[key] = roleFile as RoleFile;
    }
  }
  return result;
}

export function concatCommands(commands: (pulumi.Input<string> | undefined)[]): pulumi.Output<string> {
  return pulumi.all(commands).apply((commands) => {
    let result = "";
    for (const command of commands) {
      if (command === undefined) {
        continue;
      }
      result += command;
      if (!command.endsWith("\n")) {
        result += "\n";
      }
    }
    return result;
  });
}

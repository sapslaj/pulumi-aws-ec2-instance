import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type Architecture = "x86_64" | "arm64";

export type AMIFamily = "al2023" | "debian" | "ubuntu";

export type UbuntuVersion = "noble-24.04" | "jammy-22.04" | "focal-20.04";

export type DebianVersion = "11" | "12";

export function getLookupNames(architecture: Architecture, amiFamily: AMIFamily, amiVersion?: string): string[] {
  switch (amiFamily) {
    case "al2023": {
      const version = amiVersion ?? "2023*";
      return [`al2023-ami-${version}-${architecture}`];
    }
    case "debian": {
      const version = amiVersion ?? "12";
      if (architecture === "x86_64") {
        return [`debian-${version}-amd64-*`];
      } else {
        return [`debian-${version}-${architecture}-*`];
      }
    }
    case "ubuntu": {
      const version = amiVersion ?? "noble-24.04";
      if (architecture === "x86_64") {
        return [
          `ubuntu/images/hvm-ssd-gp3/ubuntu-${version}-amd64-server-*`,
          `ubuntu/images/hvm-ssd/ubuntu-${version}-amd64-server-*`,
        ];
      } else {
        return [
          `ubuntu/images/hvm-ssd-gp3/ubuntu-${version}-${architecture}-server-*`,
          `ubuntu/images/hvm-ssd/ubuntu-${version}-${architecture}-server-*`,
        ];
      }
    }
    default:
      throw new Error(`unknown AMIFamily: ${amiFamily}`);
  }
}

export type AMIConfig =
  & {
    id?: pulumi.Input<string>;
    architecture?: pulumi.Input<Architecture | undefined>;
  }
  & (
    | {
      family?: pulumi.Input<AMIFamily>;
      version?: pulumi.Input<string>;
    }
    | {
      family: "debian";
      version?: pulumi.Input<DebianVersion>;
    }
    | {
      family: "ubuntu";
      version?: pulumi.Input<UbuntuVersion>;
    }
  );

export const amiDefaultUsername: Record<AMIFamily, string> = {
  al2023: "ec2-user",
  debian: "admin",
  ubuntu: "ubuntu",
};

// do a `.replace("with_backoff ", "")` if you aren't pulling in the
// `with_backoff` bash function. Ditto for `sudo`.
export const amiDefaultAnsibleInstallCommand: Record<AMIFamily, string> = {
  al2023: "with_backoff sudo yum install -y ansible git",
  debian: [
    "export DEBIAN_FRONTEND=noninteractive",
    "with_backoff sudo apt-get update",
    "with_backoff sudo apt-get install -y ansible git",
  ].join(" && "),
  ubuntu: [
    "export DEBIAN_FRONTEND=noninteractive",
    "with_backoff sudo apt-get update",
    "with_backoff sudo apt-get install -y ansible git",
  ].join(" && "),
};

// do a `.replace("with_backoff ", "")` if you aren't pulling in the
// `with_backoff` bash function. Ditto for `sudo`.
export const amiDefaultAWSCLIInstallCommand: Record<AMIFamily, string> = {
  al2023: [
    "with_backoff yum install -y curl unzip",
    "with_backoff sudo curl -L 'https://raw.githubusercontent.com/sapslaj/aws-cli-installer/main/aws-cli-installer' -o /usr/local/sbin/aws-cli-installer",
    "sudo chmod +x /usr/local/sbin/aws-cli-installer",
    "with_backoff sudo /usr/local/sbin/aws-cli-installer",
  ].join(" && "),
  debian: [
    "export DEBIAN_FRONTEND=noninteractive",
    "with_backoff sudo apt-get update",
    "with_backoff sudo apt-get install -y curl unzip",
    "with_backoff sudo curl -L 'https://raw.githubusercontent.com/sapslaj/aws-cli-installer/main/aws-cli-installer' -o /usr/local/sbin/aws-cli-installer",
    "sudo chmod +x /usr/local/sbin/aws-cli-installer",
    "with_backoff sudo /usr/local/sbin/aws-cli-installer",
  ].join(" && "),
  ubuntu: [
    "export DEBIAN_FRONTEND=noninteractive",
    "with_backoff sudo apt-get update",
    "with_backoff sudo apt-get install -y curl unzip",
    "with_backoff sudo curl -L 'https://raw.githubusercontent.com/sapslaj/aws-cli-installer/main/aws-cli-installer' -o /usr/local/sbin/aws-cli-installer",
    "sudo chmod +x /usr/local/sbin/aws-cli-installer",
    "with_backoff sudo /usr/local/sbin/aws-cli-installer",
  ].join(" && "),
};

const lookupOwners: Record<AMIFamily, string[]> = {
  al2023: ["137112412989"],
  debian: ["136693071363"],
  ubuntu: ["099720109477"],
};

export interface LookupAMIResult {
  lookup: aws.ec2.GetAmiResult;
  defaultUsername: string;
  id: string;
  ansibleInstallCommand: string;
  awsCLIInstallCommand: string;
}

export function lookupAMI(config: AMIConfig): pulumi.Output<LookupAMIResult> {
  if (config.id !== undefined) {
    return pulumi.all({ family: config.family, id: config.id }).apply(async (props) => {
      let { family, id } = props;
      if (!family) {
        family = "ubuntu";
      }
      const lookup = await aws.ec2.getAmi({
        filters: [
          {
            name: "image-id",
            values: [id!],
          },
        ],
      });
      return {
        lookup,
        defaultUsername: amiDefaultUsername[family as AMIFamily],
        id: id!,
        ansibleInstallCommand: amiDefaultAnsibleInstallCommand[family as AMIFamily],
        awsCLIInstallCommand: amiDefaultAWSCLIInstallCommand[family as AMIFamily],
      };
    });
  }

  return pulumi.all({ family: config.family, architecture: config.architecture, amiVersion: config.version }).apply(
    async (props) => {
      let { family, architecture, amiVersion } = props;
      if (!family) {
        family = "ubuntu";
      }
      if (!architecture) {
        architecture = "x86_64";
      }
      const lookup = await aws.ec2.getAmi({
        mostRecent: true,
        owners: lookupOwners[family as AMIFamily],
        filters: [
          {
            name: "virtualization-type",
            values: ["hvm"],
          },
          {
            name: "name",
            values: getLookupNames(architecture as Architecture, family as AMIFamily, amiVersion),
          },
        ],
      });
      return {
        lookup,
        defaultUsername: amiDefaultUsername[family as AMIFamily],
        id: lookup.imageId,
        ansibleInstallCommand: amiDefaultAnsibleInstallCommand[family as AMIFamily],
        awsCLIInstallCommand: amiDefaultAWSCLIInstallCommand[family as AMIFamily],
      };
    },
  );
}

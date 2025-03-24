import * as aws from "@pulumi/aws";
import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";

import { AnsibleRemoteSSHProvisioner, AnsibleRemoteSSHProvisionerConfig } from "./AnsibleRemoteSSHProvisioner";
import { AnsibleS3UserDataProvisioner, AnsibleS3UserDataProvisionerConfig } from "./AnsibleS3UserDataProvisioner";
import { AnsibleUserDataProvisioner, AnsibleUserDataProvisionerConfig } from "./AnsibleUserDataProvisioner";
import { EC2InstanceCloudWatch, EC2InstanceCloudWatchConfig } from "./EC2InstanceCloudWatch";
import { EC2InstanceDNS, EC2InstanceDNSConfig } from "./EC2InstanceDNS";
import { EC2InstanceEIP, EC2InstanceEIPConfig } from "./EC2InstanceEIP";
import { EC2IAM, EC2IAMConfig } from "./EC2IAM";
import { EC2KeyPair, EC2KeyPairConfig } from "./EC2KeyPair";
import { EC2SecurityGroup, EC2SecurityGroupConfig } from "./EC2SecurityGroup";
import { AMIConfig, Architecture, lookupAMI, LookupAMIResult } from "./lookupAMI";
import { deDoubleNegativeifyOptional, mergeTags } from "./utils";

export const EC2InstanceAnsibleMethod = {
  RemoteSSH: "RemoteSSH",
  S3UserData: "S3UserData",
  UserData: "UserData",
} as const;
export type EC2InstanceAnsibleMethod = (typeof EC2InstanceAnsibleMethod)[keyof typeof EC2InstanceAnsibleMethod];

export type EC2InstanceAnsibleConfig =
  | (
    { method: "RemoteSSH" } & AnsibleRemoteSSHProvisionerConfig
  )
  | (
    { method: "S3UserData" } & AnsibleS3UserDataProvisionerConfig
  )
  | (
    { method: "UserData" } & AnsibleUserDataProvisionerConfig
  );

export interface DNSConfig extends EC2InstanceDNSConfig {
  create?: boolean;
}

export interface EIPConfig extends EC2InstanceEIPConfig {
  create?: boolean;
}

export interface EC2InstanceSecurityGroupConfig extends EC2SecurityGroupConfig {
  create?: boolean;
}

export interface InstanceConfig extends aws.ec2.InstanceArgs {
  create?: boolean;
  id?: pulumi.Input<string>;
  enableApiStop?: pulumi.Input<boolean>;
  enableApiTermination?: pulumi.Input<boolean>;
  ignoreChanges?: string[];
}

export const HostFrom = {
  DNS: "DNS",
  IPv6: "IPv6",
  PrivateDNS: "PrivateDNS",
  PrivateIPV4: "PrivateIPV4",
  PublicDNS: "PublicDNS",
  PublicIPv4: "PublicIPv4",
};
export type HostFrom = (typeof HostFrom)[keyof typeof HostFrom];

export interface ConnectionConfig extends Partial<command.types.input.remote.ConnectionArgs> {
  hostFrom?: HostFrom;
}

export interface EC2InstanceProps {
  name?: pulumi.Input<string>;
  tags?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
  ansible?: EC2InstanceAnsibleConfig;
  ami?: AMIConfig;
  cloudwatch?: EC2InstanceCloudWatchConfig;
  dns?: DNSConfig;
  eip?: EIPConfig;
  iam?: EC2IAMConfig;
  instance?: InstanceConfig;
  keyPair?: EC2KeyPairConfig;
  securityGroup?: EC2InstanceSecurityGroupConfig;
  connectionArgs?: ConnectionConfig;
}

export class EC2Instance extends pulumi.ComponentResource {
  name: pulumi.Output<string>;
  instance: aws.ec2.Instance;
  instanceType?: pulumi.Output<aws.ec2.GetInstanceTypeResult>;
  ansible?: AnsibleRemoteSSHProvisioner | AnsibleS3UserDataProvisioner | AnsibleUserDataProvisioner;
  ami?: pulumi.Output<LookupAMIResult>;
  cloudwatch?: EC2InstanceCloudWatch;
  dns?: EC2InstanceDNS;
  eip?: EC2InstanceEIP;
  iam?: EC2IAM;
  keyPair?: EC2KeyPair;
  securityGroup?: EC2SecurityGroup;
  vpcId?: pulumi.Output<string>;
  connection: command.types.input.remote.ConnectionArgs;

  constructor(id: string, props: EC2InstanceProps = {}, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2Instance", id, {}, opts);

    const name = props.name ?? id;
    this.name = pulumi.output(name);

    const instanceCreate = props.instance?.create ?? true;

    let instanceArgs: aws.ec2.InstanceArgs = props.instance ?? {};

    if (
      props.iam !== undefined || instanceArgs.iamInstanceProfile === undefined
      || props.ansible?.method === EC2InstanceAnsibleMethod.S3UserData
    ) {
      this.iam = new EC2IAM(id, {
        ...props.iam,
        tags: mergeTags(
          props.tags,
          props.iam?.tags,
        ),
      }, {
        parent: this,
      });

      if (instanceArgs.iamInstanceProfile === undefined) {
        instanceArgs.iamInstanceProfile = this.iam.instanceProfile;
      }
    }

    if (instanceArgs.instanceType !== undefined) {
      this.instanceType = aws.ec2.getInstanceTypeOutput({
        instanceType: instanceArgs.instanceType,
      });
    }

    if (instanceArgs.launchTemplate === undefined && instanceArgs.ami === undefined) {
      const architecture = this.instanceType?.supportedArchitectures.apply(
        (supportedArchitectures) => {
          if (supportedArchitectures.length === 0) {
            return undefined;
          }
          return supportedArchitectures[0] as Architecture;
        },
      );
      this.ami = lookupAMI({
        architecture,
        ...props.ami,
      });
      instanceArgs.ami = this.ami.id;
    }

    instanceArgs.disableApiStop = deDoubleNegativeifyOptional(
      (t) => !t,
      props.instance?.enableApiStop,
      props.instance?.disableApiStop,
    );
    instanceArgs.disableApiTermination = deDoubleNegativeifyOptional(
      (t) => !t,
      props.instance?.enableApiTermination,
      props.instance?.disableApiTermination,
    );

    instanceArgs.tags = mergeTags(
      {
        Name: name,
      },
      props.tags,
      instanceArgs.tags,
    );

    if (instanceArgs.subnetId) {
      this.vpcId = aws.ec2.getSubnetOutput({
        id: instanceArgs.subnetId,
      }).vpcId;
    }

    if (props.securityGroup?.create !== false) {
      this.securityGroup = new EC2SecurityGroup(id, {
        vpcId: this.vpcId,
        ...props.securityGroup,
      }, {
        parent: this,
      });

      instanceArgs.vpcSecurityGroupIds = pulumi.all({
        vpcSecurityGroupIds: props.instance?.vpcSecurityGroupIds,
        defaultSecurityGroupId: this.securityGroup.id,
      }).apply(({ vpcSecurityGroupIds, defaultSecurityGroupId }) => {
        return [
          defaultSecurityGroupId,
          ...(vpcSecurityGroupIds ?? []),
        ] as string[];
      });
    }

    if (instanceArgs.keyName === undefined || props.keyPair !== undefined) {
      this.keyPair = new EC2KeyPair(id, {
        ...props.keyPair,
      });
    }
    if (instanceArgs.keyName === undefined && this.keyPair?.keyPair) {
      instanceArgs.keyName = this.keyPair.keyPair.id;
    }

    if (props.ansible?.method === EC2InstanceAnsibleMethod.UserData) {
      this.ansible = new AnsibleUserDataProvisioner(id, {
        ansibleInstallCommand: this.ami?.ansibleInstallCommand,
        defaultHostname: this.dns?.hostname ?? name,
        ...props.ansible,
      });

      if (instanceArgs.userData === undefined && instanceArgs.userDataBase64 === undefined) {
        instanceArgs.userData = this.ansible.userData;
      }
    }

    if (props.ansible?.method === EC2InstanceAnsibleMethod.S3UserData) {
      this.ansible = new AnsibleS3UserDataProvisioner(id, {
        instanceName: name,
        role: this.iam?.role,
        ansibleInstallCommand: this.ami?.ansibleInstallCommand,
        awsCLIInstallCommand: this.ami?.awsCLIInstallCommand,
        defaultHostname: this.dns?.hostname ?? name,
        ...props.ansible,
        tags: mergeTags(props.tags, props.ansible.tags),
      });

      if (instanceArgs.userData === undefined && instanceArgs.userDataBase64 === undefined) {
        instanceArgs.userData = this.ansible.userData;
      }
    }

    if (instanceCreate) {
      if (instanceArgs.launchTemplate === undefined && instanceArgs.instanceType === undefined) {
        throw new Error("An instance type must be set if not using a launch template.");
      }

      this.instance = new aws.ec2.Instance(id, instanceArgs, {
        parent: this,
        ignoreChanges: props.instance?.ignoreChanges,
      });
    } else {
      if (!props.instance?.id) {
        throw new Error("instance ID must be provided when using EC2Instance component without creating an instance.");
      }

      this.instance = aws.ec2.Instance.get(id, props.instance.id, undefined, {
        parent: this,
      });
    }

    if (props.eip?.create) {
      this.eip = new EC2InstanceEIP(id, {
        ...props.eip,
        instanceId: this.instance.id,
        tags: mergeTags(props.tags, props.eip?.tags),
      }, {
        parent: this,
      });
    }

    if (props.dns?.create) {
      this.dns = new EC2InstanceDNS(id, {
        instance: this.instance,
        instanceName: name,
        ...props.dns,
      });
    }

    this.cloudwatch = new EC2InstanceCloudWatch(id, {
      ...props.cloudwatch,
      instanceName: name,
      instanceId: this.instance.id,
      tags: mergeTags(props.tags, props.cloudwatch?.tags),
    }, {
      parent: this,
    });

    let connectionHost: pulumi.Input<string>;
    const connectionHostFrom = props.connectionArgs?.hostFrom ?? HostFrom.PrivateIPV4;

    switch (connectionHostFrom) {
      case HostFrom.DNS: {
        if (!this.dns) {
          throw new Error("Cannot use HostFrom.DNS since a DNS record is not being created for the instance");
        }
        connectionHost = this.dns.hostname;
        break;
      }
      case HostFrom.IPv6: {
        connectionHost = this.instance.ipv6Addresses.apply((ipv6Addresses) => ipv6Addresses[0]);
        break;
      }
      case HostFrom.PrivateDNS: {
        connectionHost = this.instance.privateDns;
        break;
      }
      case HostFrom.PublicDNS: {
        connectionHost = this.instance.publicDns;
        break;
      }
      case HostFrom.PublicIPv4: {
        if (this.eip) {
          connectionHost = this.eip.publicIp;
        } else {
          connectionHost = this.instance.publicIp;
        }
      }
      default: {
        connectionHost = this.instance.privateIp;
      }
    }

    let connection: command.types.input.remote.ConnectionArgs = {
      host: connectionHost,
      ...props.connectionArgs,
    };

    if (this.ami && !connection.user) {
      connection.user = this.ami.defaultUsername;
    }

    if (this.keyPair?.privatekey && !connection.privateKey) {
      connection.privateKey = this.keyPair.privatekey;
    }

    this.connection = connection;

    if (props.ansible?.method === EC2InstanceAnsibleMethod.RemoteSSH) {
      this.ansible = new AnsibleRemoteSSHProvisioner(id, {
        connection,
        instanceName: name,
        ansibleInstallCommand: this.ami?.ansibleInstallCommand,
        defaultHostname: this.dns?.hostname ?? name,
        ...props.ansible,
      });
    }
  }
}

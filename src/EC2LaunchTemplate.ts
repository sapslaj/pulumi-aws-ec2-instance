import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { AnsibleS3UserDataProvisioner, AnsibleS3UserDataProvisionerConfig } from "./AnsibleS3UserDataProvisioner";
import { AnsibleUserDataProvisioner, AnsibleUserDataProvisionerConfig } from "./AnsibleUserDataProvisioner";
import { EC2IAM, EC2IAMConfig } from "./EC2IAM";
import { EC2KeyPair, EC2KeyPairConfig } from "./EC2KeyPair";
import { EC2SecurityGroup, EC2SecurityGroupConfig } from "./EC2SecurityGroup";
import { AMIConfig, Architecture, lookupAMI, LookupAMIResult } from "./lookupAMI";
import { deDoubleNegativeifyOptional, mergeTags } from "./utils";

export const EC2LaunchTemplateAnsibleMethod = {
  S3UserData: "S3UserData",
  UserData: "UserData",
} as const;
export type EC2LaunchTemplateAnsibleMethod =
  (typeof EC2LaunchTemplateAnsibleMethod)[keyof typeof EC2LaunchTemplateAnsibleMethod];

export type EC2LaunchTemplateAnsibleConfig =
  | (
    { method: "S3UserData" } & AnsibleS3UserDataProvisionerConfig
  )
  | (
    { method: "UserData" } & AnsibleUserDataProvisionerConfig
  );

export interface EC2LaunchTemplateSecurityGroupConfig extends EC2SecurityGroupConfig {
  create?: boolean;
  vpcId?: pulumi.Input<string>;
}

export interface LaunchTemplateConfig extends aws.ec2.LaunchTemplateArgs {
  enableApiStop?: pulumi.Input<boolean>;
  enableApiTermination?: pulumi.Input<boolean>;
  ignoreChanges?: string[];
}

export interface EC2LaunchTemplateProps {
  name?: pulumi.Input<string>;
  tags?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
  ansible?: EC2LaunchTemplateAnsibleConfig;
  ami?: AMIConfig;
  iam?: EC2IAMConfig;
  keyPair?: EC2KeyPairConfig;
  launchTemplate?: LaunchTemplateConfig;
  securityGroup?: EC2LaunchTemplateSecurityGroupConfig;
}

export class EC2LaunchTemplate extends pulumi.ComponentResource {
  instanceType?: pulumi.Output<aws.ec2.GetInstanceTypeResult>;
  iam?: EC2IAM;
  ami?: pulumi.Output<LookupAMIResult>;
  vpcId?: pulumi.Output<string>;
  securityGroup?: EC2SecurityGroup;
  keyPair?: EC2KeyPair;
  ansible?: AnsibleS3UserDataProvisioner | AnsibleUserDataProvisioner;
  launchTemplate: aws.ec2.LaunchTemplate;

  constructor(id: string, props: EC2LaunchTemplateProps = {}, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2LaunchTemplate", id, {}, opts);

    let ltArgs: aws.ec2.LaunchTemplateArgs = props.launchTemplate ?? {};

    if (ltArgs.defaultVersion === undefined && ltArgs.updateDefaultVersion === undefined) {
      ltArgs.updateDefaultVersion = true;
    }

    if (
      props.iam !== undefined || ltArgs.iamInstanceProfile === undefined
      || props.ansible?.method === EC2LaunchTemplateAnsibleMethod.S3UserData
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

      if (!ltArgs.iamInstanceProfile && this.iam.instanceProfile) {
        ltArgs.iamInstanceProfile = {
          name: this.iam.instanceProfile?.name,
        };
      }
    }

    if (ltArgs.instanceType !== undefined) {
      this.instanceType = aws.ec2.getInstanceTypeOutput({
        instanceType: ltArgs.instanceType,
      });
    }

    if (ltArgs.imageId === undefined) {
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
      ltArgs.imageId = this.ami.id;
    }

    ltArgs.disableApiStop = deDoubleNegativeifyOptional(
      (t) => !t,
      props.launchTemplate?.enableApiStop,
      props.launchTemplate?.disableApiStop,
    );
    ltArgs.disableApiTermination = deDoubleNegativeifyOptional(
      (t) => !t,
      props.launchTemplate?.enableApiTermination,
      props.launchTemplate?.disableApiTermination,
    );

    ltArgs.tags = mergeTags(
      props.tags,
      ltArgs.tags,
    );

    if (props.securityGroup?.vpcId) {
      this.vpcId = pulumi.output(props.securityGroup.vpcId);
    }

    let createSG: boolean;
    if (props.securityGroup?.create === false) {
      createSG = false;
    } else if (props.securityGroup?.create === true) {
      createSG = true;
    } else if (props.securityGroup?.create === undefined && this.vpcId) {
      createSG = true;
    } else if (props.securityGroup?.create === undefined && !this.vpcId) {
      createSG = false;
    } else {
      createSG = false;
    }
    if (createSG) {
      this.securityGroup = new EC2SecurityGroup(id, {
        vpcId: this.vpcId,
        ...props.securityGroup,
      }, {
        parent: this,
      });

      ltArgs.vpcSecurityGroupIds = pulumi.all({
        vpcSecurityGroupIds: props.launchTemplate?.vpcSecurityGroupIds,
        defaultSecurityGroupId: this.securityGroup.id,
      }).apply(({ vpcSecurityGroupIds, defaultSecurityGroupId }) => {
        return [
          defaultSecurityGroupId,
          ...(vpcSecurityGroupIds ?? []),
        ] as string[];
      });
    }

    if (ltArgs.keyName === undefined || props.keyPair !== undefined) {
      this.keyPair = new EC2KeyPair(id, {
        ...props.keyPair,
      });
    }
    if (ltArgs.keyName === undefined && this.keyPair?.keyPair) {
      ltArgs.keyName = this.keyPair.keyPair.id;
    }

    if (props.ansible?.method === EC2LaunchTemplateAnsibleMethod.UserData) {
      this.ansible = new AnsibleUserDataProvisioner(id, {
        ansibleInstallCommand: this.ami?.ansibleInstallCommand,
        ...props.ansible,
      });

      if (ltArgs.userData === undefined) {
        ltArgs.userData = this.ansible.userDataBase64();
      }
    }

    if (props.ansible?.method === EC2LaunchTemplateAnsibleMethod.S3UserData) {
      this.ansible = new AnsibleS3UserDataProvisioner(id, {
        role: this.iam?.role,
        ansibleInstallCommand: this.ami?.ansibleInstallCommand,
        awsCLIInstallCommand: this.ami?.awsCLIInstallCommand,
        ...props.ansible,
        tags: mergeTags(props.tags, props.ansible.tags),
      });

      if (ltArgs.userData === undefined) {
        ltArgs.userData = this.ansible.userDataBase64();
      }
    }

    this.launchTemplate = new aws.ec2.LaunchTemplate(id, ltArgs, {
      parent: this,
    });
  }
}

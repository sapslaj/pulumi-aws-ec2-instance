import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as pulumistd from "@pulumi/std";
import {
  AnsibleProvisionerProps,
  bashBackoffRetryFunction,
  buildFileWriteCommand,
  buildRemotePathInitCommand,
  buildRunCommand,
  defaultRemotePath,
  makePlaybookOutput,
} from "@sapslaj/pulumi-ansible-provisioner";
import { fileHash } from "@sapslaj/pulumi-ansible-provisioner/lib/asset-utils";
import * as YAML from "yaml";

import { concatCommands, gatherRolesFiles, makeSetHostnameCommand } from "./ansible-utils";
import { iamPolicyDocument } from "./EC2IAM";
import { mergeTags } from "./utils";

export interface AnsibleS3UserDataProvisionerConfig extends Omit<AnsibleProvisionerProps, "connection"> {
  createBucket?: boolean;
  createBucketObjects?: boolean;
  createBucketIAMRolePolicy?: boolean;
  setHostname?: boolean | pulumi.Input<string>;
  setHostnameCommand?: pulumi.Input<string>;
  bucketConfig?: Partial<aws.s3.BucketArgs>;
  objectConfig?: Partial<aws.s3.BucketObjectArgs>;
  rolePolicyConfig?: Partial<aws.iam.RolePolicyArgs>;
  tags?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
  awsCLIInstallCommand?: pulumi.Input<string>;
}

export interface AnsibleS3UserDataProvisionerProps extends AnsibleS3UserDataProvisionerConfig {
  instanceName?: pulumi.Input<string>;
  defaultHostname?: pulumi.Input<string>;
  role?: pulumi.Input<string | aws.iam.Role>;
}

export function buildS3CopyCommand({ bucketName, remotePath }: { bucketName: string; remotePath: string }): string {
  return `aws s3 cp --recursive "s3://${bucketName}/" "${remotePath}"`;
}

export function makeS3CopyCommand(
  inputs: { bucketName: pulumi.Input<string>; remotePath: pulumi.Input<string> },
): pulumi.Output<string> {
  return pulumi.all(inputs).apply(({ bucketName, remotePath }) => buildS3CopyCommand({ bucketName, remotePath }));
}

export class AnsibleS3UserDataProvisioner extends pulumi.ComponentResource {
  bucket?: aws.s3.Bucket;
  bucketObjects?: Record<string, aws.s3.BucketObject>;
  bucketAccessPolicyDocument: pulumi.Output<string>;
  bucketIAMRolePolicy?: aws.iam.RolePolicy;
  userData: pulumi.Output<string>;

  constructor(name: string, props: AnsibleS3UserDataProvisionerProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:AnsibleS3UserDataProvisioner", name, {}, opts);

    let bucketName: pulumi.Input<string>;

    if (props.createBucket !== false) {
      let bucketConfig = props.bucketConfig ?? {};
      if (bucketConfig.forceDestroy === undefined) {
        bucketConfig.forceDestroy = true;
      }
      if (!bucketConfig.bucket && !bucketConfig.bucketPrefix) {
        if (props.instanceName) {
          bucketConfig.bucketPrefix = pulumi.output(props.instanceName).apply((instanceName) =>
            `${instanceName.substring(0, 24)}-provisioning`
          );
        } else {
          bucketConfig.bucketPrefix = name;
        }
      }
      bucketConfig.tags = mergeTags(props.tags, bucketConfig.tags);
      this.bucket = new aws.s3.Bucket(name, bucketConfig, {
        parent: this,
      });
      bucketName = this.bucket.bucket;
    } else {
      if (!props.bucketConfig?.bucket) {
        throw new Error("S3 bucket must be created or configured.");
      }
      bucketName = props.bucketConfig.bucket;
    }

    let bucketArn: pulumi.Output<string>;
    if (this.bucket) {
      bucketArn = this.bucket.arn;
    } else {
      bucketArn = pulumi.concat("arn:aws:s3:::", bucketName);
    }

    this.bucketAccessPolicyDocument = iamPolicyDocument({
      statements: [
        {
          actions: [
            "s3:ListBucket",
            "s3:ListBucketVersions",
            "s3:GetObject",
            "s3:GetObjectAcl",
            "s3:GetObjectTagging",
            "s3:GetObjectVersion",
          ],
          resources: [
            bucketArn,
            pulumi.concat(bucketArn, "/*"),
          ],
        },
      ],
    });

    if (this.bucket) {
      new aws.s3.BucketPublicAccessBlock(name, {
        bucket: this.bucket.bucket,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      }, {
        parent: this,
      });

      new aws.s3.BucketServerSideEncryptionConfigurationV2(name, {
        bucket: this.bucket.bucket,
        rules: [
          {
            applyServerSideEncryptionByDefault: {
              sseAlgorithm: "AES256",
            },
          },
        ],
      }, {
        parent: this,
      });
    }

    if (props.createBucketObjects !== false) {
      this.bucketObjects = {};

      const rolesFiles = gatherRolesFiles(props.rolePaths ?? []);

      for (const [key, roleFile] of Object.entries(rolesFiles)) {
        this.bucketObjects[key] = new aws.s3.BucketObject(`${name}-${key}`, {
          bucket: bucketName,
          key,
          source: new pulumi.asset.FileAsset(roleFile.absoluteFileLocation),
          etag: fileHash(roleFile.absoluteFileLocation),
          ...props.objectConfig,
          tags: mergeTags(props.tags, props.objectConfig?.tags),
        }, {
          parent: this,
        });
      }
    }

    if (props.createBucketIAMRolePolicy ?? props.rolePolicyConfig ?? props.role) {
      this.bucketIAMRolePolicy = new aws.iam.RolePolicy(name, {
        role: props.rolePolicyConfig?.role ?? props.role!,
        policy: this.bucketAccessPolicyDocument,
        ...props.rolePolicyConfig,
      }, {
        parent: this,
      });
    }

    const setHostnameCommand = makeSetHostnameCommand(props);
    const remotePath = props.remotePath ?? defaultRemotePath;

    const userDataCommands: pulumi.Input<string>[] = [
      "#!/bin/bash\n",
      "set -euo pipefail\n",
      bashBackoffRetryFunction,
    ];

    userDataCommands.push(
      pulumi.output(remotePath).apply((remotePath) => buildRemotePathInitCommand({ remotePath })),
    );

    if (props.ansibleInstallCommand) {
      userDataCommands.push(props.ansibleInstallCommand);
    }
    if (props.awsCLIInstallCommand) {
      userDataCommands.push(props.awsCLIInstallCommand);
    }
    if (setHostnameCommand) {
      userDataCommands.push(setHostnameCommand);
    }

    userDataCommands.push(
      makeS3CopyCommand({
        remotePath,
        bucketName,
      }),
    );

    if (props.requirements !== undefined) {
      userDataCommands.push(
        pulumi.all({ remotePath, requirements: props.requirements }).apply(({ remotePath, requirements }) =>
          buildFileWriteCommand(`${remotePath}/requirements.yml`, YAML.stringify(requirements))
        ),
      );
    }

    const playbook = makePlaybookOutput(props);

    userDataCommands.push(
      pulumi.all({ remotePath, playbook }).apply(({ remotePath, playbook }) =>
        buildFileWriteCommand(`${remotePath}/main.yml`, YAML.stringify(playbook))
      ),
    );

    userDataCommands.push(
      pulumi.output(remotePath).apply((remotePath) =>
        buildRunCommand({
          remotePath,
          id: "main",
          withBackoffDefinition: "",
        })
      ),
    );

    this.userData = concatCommands(userDataCommands);
  }

  userDataBase64(): pulumi.Output<string> {
    return pulumistd.base64encodeOutput({
      input: this.userData,
    }).result;
  }
}

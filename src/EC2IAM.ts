import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { mergeTags } from "./utils";

export function iamPolicyDocument(
  args?: aws.iam.GetPolicyDocumentOutputArgs,
  opts?: pulumi.InvokeOutputOptions,
): pulumi.Output<string> {
  return aws.iam.getPolicyDocumentOutput(args, opts).json;
}

export const defaultIAMPolicies: Record<string, pulumi.Input<string>> = {
  AmazonSSMManagedInstanceCore: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
};

export interface EC2IAMConfig {
  createRole?: boolean;
  createInstanceProfile?: boolean;
  attachDefaultPolicies?: boolean;
  managedPolicies?: Record<string, pulumi.Input<string>>;
  roleName?: pulumi.Input<string>;
  roleConfig?: Partial<aws.iam.RoleArgs>;
  instanceProfileConfig?: Partial<aws.iam.InstanceProfileArgs>;
  rolePolicyAttachmentsExclusive?: boolean;
  policies?: Record<string, pulumi.Input<string>>;
  rolePoliciesExclusive?: boolean;
  tags?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
}

export interface EC2IAMProps extends EC2IAMConfig {
}

export class EC2IAM extends pulumi.ComponentResource {
  role?: aws.iam.Role;
  instanceProfile?: aws.iam.InstanceProfile;
  rolePolicyAttachments?: Record<string, aws.iam.RolePolicyAttachment>;
  rolePolicies?: Record<string, aws.iam.RolePolicy>;

  constructor(name: string, props: EC2IAMProps, opts?: pulumi.ComponentResourceOptions) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2IAM", name, {}, opts);

    if (props.createRole !== false) {
      this.role = new aws.iam.Role(name, {
        assumeRolePolicy: iamPolicyDocument({
          statements: [
            {
              actions: ["sts:AssumeRole"],
              principals: [
                {
                  type: "Service",
                  identifiers: ["ec2.amazonaws.com"],
                },
              ],
            },
          ],
        }),
        name: props.roleName,
        ...props.roleConfig,
        tags: mergeTags(props.tags, props.roleConfig?.tags),
      }, {
        parent: this,
      });
    }

    const getRoleName = () => {
      if (this.role) {
        return this.role.name;
      }
      if (props.roleName) {
        return pulumi.output(props.roleName);
      }
      if (props.roleConfig?.name) {
        return pulumi.output(props.roleConfig.name);
      }
      if (props.instanceProfileConfig?.role) {
        return pulumi.output(props.instanceProfileConfig.role).apply((role) => {
          if (typeof role === "string") {
            return role;
          }
          return role.name;
        }) as pulumi.Output<string>;
      }
      throw new Error(`roleName must be specified when not creating a role`);
    };

    if (props.createInstanceProfile ?? Boolean(this.role)) {
      this.instanceProfile = new aws.iam.InstanceProfile(name, {
        role: getRoleName(),
        ...props.instanceProfileConfig,
        tags: mergeTags(props.tags, props.instanceProfileConfig?.tags),
      }, {
        parent: this,
      });
    }

    let managedPolicies: Record<string, pulumi.Input<string>> = {};
    this.rolePolicyAttachments = {};
    if (props.attachDefaultPolicies ?? props.createRole) {
      managedPolicies = {
        ...managedPolicies,
        ...defaultIAMPolicies,
      };
    }
    if (props.managedPolicies) {
      managedPolicies = {
        ...managedPolicies,
        ...props.managedPolicies,
      };
    }
    for (const [key, policyArn] of Object.entries(managedPolicies)) {
      this.rolePolicyAttachments[key] = new aws.iam.RolePolicyAttachment(`${name}-${key}`, {
        role: getRoleName(),
        policyArn,
      }, {
        parent: this,
      });
    }
    if (props.rolePolicyAttachmentsExclusive) {
      new aws.iam.RolePolicyAttachmentsExclusive(name, {
        roleName: getRoleName(),
        policyArns: Object.values(managedPolicies),
      }, {
        parent: this,
      });
    }

    let policies = {
      ...props.policies,
    };
    this.rolePolicies = {};
    for (const [key, policy] of Object.entries(policies)) {
      this.rolePolicies[key] = new aws.iam.RolePolicy(`${name}-${key}`, {
        name: key,
        role: getRoleName(),
        policy,
      }, {
        parent: this,
      });
    }
    if (props.rolePoliciesExclusive) {
      new aws.iam.RolePoliciesExclusive(name, {
        roleName: getRoleName(),
        policyNames: Object.keys(this.rolePolicies),
      }, {
        parent: this,
      });
    }
  }
}

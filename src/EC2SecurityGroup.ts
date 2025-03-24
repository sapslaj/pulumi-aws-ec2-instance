import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export type SecurityGroupRule =
  & (
    {
      ipProtocol: "-1" | "icmpv6";
    } | {
      ipProtocol: pulumi.Input<string>;
      port: pulumi.Input<number>;
    } | {
      ipProtocol: pulumi.Input<string>;
      fromPort: pulumi.Input<number>;
      toPort: pulumi.Input<number>;
    }
  )
  & (
    {
      cidrIpv4: pulumi.Input<string>;
    } | {
      cidrIpv6: pulumi.Input<string>;
    } | {
      prefixListId: pulumi.Input<string>;
    } | {
      referencedSecurityGroupId: pulumi.Input<string>;
    }
  );

export function securityGroupRuleToProviderType(rule: SecurityGroupRule) {
  const unsafeRule = rule as any;
  let finalRule: {
    ipProtocol: pulumi.Input<string>;
    fromPort?: pulumi.Input<number>;
    toPort?: pulumi.Input<number>;
    cidrIpv4: pulumi.Input<string>;
    cidrIpv6: pulumi.Input<string>;
    prefixListId: pulumi.Input<string>;
    referencedSecurityGroupId: pulumi.Input<string>;
  } = unsafeRule;
  if (unsafeRule.port !== undefined) {
    finalRule.toPort = unsafeRule.port;
    finalRule.fromPort = unsafeRule.port;
    delete (finalRule as any).port;
  }
  return finalRule;
}

export interface EC2SecurityGroupConfig extends Omit<aws.ec2.SecurityGroupArgs, "ingress" | "egress" | "vpcId"> {
  createDefaultEgressRule?: boolean;
  createDefaultProvisionerRule?: boolean;
  ingresses?: Record<string, SecurityGroupRule>;
  egresses?: Record<string, SecurityGroupRule>;
}

export interface EC2SecurityGroupProps extends EC2SecurityGroupConfig {
  vpcId?: pulumi.Input<string>;
}

export class EC2SecurityGroup extends aws.ec2.SecurityGroup {
  defaultEgressIpv4Rule?: aws.vpc.SecurityGroupEgressRule;
  defaultEgressIpv6Rule?: aws.vpc.SecurityGroupEgressRule;
  defaultProvisionerRule?: aws.vpc.SecurityGroupIngressRule;
  egressRules: Record<string, aws.vpc.SecurityGroupEgressRule>;
  ingressRules: Record<string, aws.vpc.SecurityGroupIngressRule>;

  constructor(name: string, props: EC2SecurityGroupProps = {}, opts: pulumi.CustomResourceOptions = {}) {
    super(name, props, opts);

    if (props.createDefaultEgressRule !== false) {
      this.defaultEgressIpv4Rule = new aws.vpc.SecurityGroupEgressRule(`${name}-default-egress-ipv4`, {
        securityGroupId: this.id,
        description: "default egress",
        ipProtocol: "-1",
        cidrIpv4: "0.0.0.0/0",
      }, {
        parent: this,
      });

      this.defaultEgressIpv6Rule = new aws.vpc.SecurityGroupEgressRule(`${name}-default-egress-ipv6`, {
        securityGroupId: this.id,
        description: "default egress",
        ipProtocol: "-1",
        cidrIpv6: "::/0",
      }, {
        parent: this,
      });
    }

    if (props.createDefaultProvisionerRule) {
      this.defaultProvisionerRule = new aws.vpc.SecurityGroupIngressRule(`${name}-default-provisioner-rule`, {
        securityGroupId: this.id,
        description: "provisioner",
        ipProtocol: "-1",
        cidrIpv4: pulumi.output((async () => {
          const res = await fetch("https://checkip.amazonaws.com");
          const body = await res.text();
          return body.trim() + "/32";
        })()),
      }, {
        parent: this,
      });
    }

    this.ingressRules = {};
    Object.entries(props.ingresses ?? {}).forEach(([key, rule]) =>
      this.ingressRules[key] = new aws.vpc.SecurityGroupIngressRule(`${name}-${key}`, {
        securityGroupId: this.id,
        ...securityGroupRuleToProviderType(rule),
      }, {
        parent: this,
      })
    );

    this.egressRules = {};
    Object.entries(props.egresses ?? {}).forEach(([key, rule]) =>
      this.egressRules[key] = new aws.vpc.SecurityGroupEgressRule(`${name}-${key}`, {
        securityGroupId: this.id,
        ...securityGroupRuleToProviderType(rule),
      }, {
        parent: this,
      })
    );
  }
}

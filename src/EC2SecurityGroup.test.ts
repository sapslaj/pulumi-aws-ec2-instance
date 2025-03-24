import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import t from "tap";

import { EC2SecurityGroup, securityGroupRuleToProviderType } from "./EC2SecurityGroup";

t.test("securityGroupRuleToProviderType", async (t) => {
  t.test("all traffic", async (t) => {
    t.match(
      securityGroupRuleToProviderType({
        ipProtocol: "-1",
        cidrIpv4: "0.0.0.0/0",
      }),
      {
        ipProtocol: "-1",
        cidrIpv4: "0.0.0.0/0",
      },
    );
  });

  t.test("tcp with fromPort/toPort", async (t) => {
    t.match(
      securityGroupRuleToProviderType({
        ipProtocol: "tcp",
        cidrIpv4: "0.0.0.0/0",
        fromPort: 69,
        toPort: 420,
      }),
      {
        ipProtocol: "tcp",
        cidrIpv4: "0.0.0.0/0",
        fromPort: 69,
        toPort: 420,
      },
    );
  });

  t.test("tcp with port", async (t) => {
    t.match(
      securityGroupRuleToProviderType({
        ipProtocol: "tcp",
        cidrIpv4: "0.0.0.0/0",
        port: 420,
      }),
      {
        ipProtocol: "tcp",
        cidrIpv4: "0.0.0.0/0",
        fromPort: 420,
        toPort: 420,
      },
    );
  });
});

t.test("EC2SecurityGroup", async (t) => {
  t.before(() => {
    pulumi.runtime.setMocks(
      {
        newResource: function(args: pulumi.runtime.MockResourceArgs): { id: string; state: any } {
          return {
            id: args.inputs.name + "_id",
            state: args.inputs,
          };
        },
        call: function(args: pulumi.runtime.MockCallArgs) {
          return args.inputs;
        },
      },
      "project",
      "stack",
      false,
    );
  });

  t.test("creates default egress rules by default", async (t) => {
    const defaultSg = new EC2SecurityGroup("default-sg");
    const enabledSg = new EC2SecurityGroup("enabled-sg", {
      createDefaultEgressRule: true,
    });

    [
      defaultSg.defaultEgressIpv4Rule,
      defaultSg.defaultEgressIpv6Rule,
      enabledSg.defaultEgressIpv4Rule,
      enabledSg.defaultEgressIpv6Rule,
    ].forEach((maybeRule) => t.type(maybeRule, aws.vpc.SecurityGroupEgressRule));
  });

  t.test("allows default egress rule creation to be disabled", async (t) => {
    const disabledSg = new EC2SecurityGroup("disabled-sg", {
      createDefaultEgressRule: false,
    });
    [
      disabledSg.defaultEgressIpv4Rule,
      disabledSg.defaultEgressIpv6Rule,
    ].forEach((maybeRule) => t.equal(maybeRule, undefined));
  });

  t.test("creates ingress and egress rules", async (t) => {
    const sg = new EC2SecurityGroup("sg", {
      createDefaultEgressRule: false,
      ingresses: {
        test1: {
          ipProtocol: "-1",
          referencedSecurityGroupId: "sg-abcdef",
        },
        test2: {
          ipProtocol: "tcp",
          port: 80,
          cidrIpv4: "0.0.0.0/0",
        },
        test3: {
          ipProtocol: "tcp",
          fromPort: 9000,
          toPort: 9999,
          cidrIpv6: "2001:db8::/32",
        },
      },
      egresses: {
        test1: {
          ipProtocol: "udp",
          port: 53,
          cidrIpv4: "8.8.8.8/32",
        },
      },
    });

    [
      sg.ingressRules.test1,
      sg.ingressRules.test2,
      sg.ingressRules.test3,
    ].forEach((maybeRule) => t.type(maybeRule, aws.vpc.SecurityGroupIngressRule));

    [
      sg.egressRules.test1,
    ].forEach((maybeRule) => t.type(maybeRule, aws.vpc.SecurityGroupEgressRule));
  });
});

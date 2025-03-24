import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { EC2LaunchTemplate, EC2LaunchTemplateProps } from "./EC2LaunchTemplate";

export interface EC2ASGProps {
  maxSize: pulumi.Input<number>;
  minSize: pulumi.Input<number>;
  autoscalingGroup?: Partial<aws.autoscaling.GroupArgs>;
  vpcId?: pulumi.Input<string>;
  launchTemplate?:
    | aws.ec2.LaunchTemplate
    | EC2LaunchTemplate
    | EC2LaunchTemplateProps;
  mixedInstancesPolicy?: Omit<aws.types.input.autoscaling.GroupMixedInstancesPolicy, "launchTemplate">;
}

export class EC2ASG extends pulumi.ComponentResource {
  vpcId?: pulumi.Output<string>;
  launchTemplate?: EC2LaunchTemplate;
  autoscalingGroup: aws.autoscaling.Group;

  constructor(id: string, props: EC2ASGProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2ASG", id, {}, opts);

    let asgArgs: aws.autoscaling.GroupArgs = {
      maxSize: props.maxSize,
      minSize: props.minSize,
      ...props.autoscalingGroup,
    };

    const attachLaunchTemplate = (lt: aws.ec2.LaunchTemplate) => {
      if (props.mixedInstancesPolicy) {
        asgArgs.mixedInstancesPolicy = {
          launchTemplate: {
            launchTemplateSpecification: {
              launchTemplateId: lt.id,
              version: lt.latestVersion.apply((v) => v.toString()),
            },
          },
          ...props.mixedInstancesPolicy,
        };
      } else {
        asgArgs.launchTemplate = {
          id: lt.id,
          version: lt.latestVersion.apply((v) => v.toString()),
        };
      }
    };

    if (props.vpcId) {
      this.vpcId = pulumi.output(props.vpcId);
    } else if (asgArgs.vpcZoneIdentifiers) {
      this.vpcId = pulumi.output(asgArgs.vpcZoneIdentifiers).apply(async (vpcZoneIdentifiers) => {
        const subnet = await aws.ec2.getSubnet({
          id: vpcZoneIdentifiers[0],
        });
        return subnet.vpcId;
      });
    }

    if (props.launchTemplate instanceof EC2LaunchTemplate) {
      this.launchTemplate = props.launchTemplate;
      attachLaunchTemplate(this.launchTemplate.launchTemplate);
    } else if (props.launchTemplate instanceof aws.ec2.LaunchTemplate) {
      attachLaunchTemplate(props.launchTemplate);
    } else {
      this.launchTemplate = new EC2LaunchTemplate(id, {
        ...props.launchTemplate,
        securityGroup: {
          vpcId: this.vpcId,
          ...props.launchTemplate?.securityGroup,
        },
      }, {
        parent: this,
      });
      attachLaunchTemplate(this.launchTemplate.launchTemplate);
    }

    if (!this.vpcId && this.launchTemplate) {
      this.vpcId = this.launchTemplate.vpcId;
    }

    this.autoscalingGroup = new aws.autoscaling.Group(id, asgArgs, {
      parent: this,
    });
  }
}

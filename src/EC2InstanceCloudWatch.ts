import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { mergeTags } from "./utils";

export interface MetricAlarms {
  instanceStatusCheck?: boolean;
  systemStatusCheck?: boolean;
}

export interface EC2InstanceCloudWatchConfig {
  metricAlarms?: MetricAlarms;
  tags?: pulumi.Input<{
    [key: string]: pulumi.Input<string>;
  }>;
}

export interface EC2InstanceCloudWatchProps extends EC2InstanceCloudWatchConfig {
  instanceId: pulumi.Input<string>;
  instanceName?: pulumi.Input<string>;
}

export class EC2InstanceCloudWatch extends pulumi.ComponentResource {
  metricAlarms: Partial<Record<keyof MetricAlarms, aws.cloudwatch.MetricAlarm>>;

  constructor(name: string, props: EC2InstanceCloudWatchProps, opts?: pulumi.ComponentResourceOptions) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2InstanceCloudWatch", name, {}, opts);

    const instanceName = props.instanceName ?? name;

    const currentRegion = aws.getRegionOutput({}, {
      parent: this,
    });
    const currentAccount = aws.getCallerIdentityOutput({}, {
      parent: this,
    });

    this.metricAlarms = {};

    if (props.metricAlarms?.instanceStatusCheck !== false) {
      this.metricAlarms.instanceStatusCheck = new aws.cloudwatch.MetricAlarm(
        `${name}-instance-status-check`,
        {
          name: pulumi.concat(props.instanceId, "-status-check-failed-instance"),
          evaluationPeriods: 2,
          period: 60,
          namespace: "AWS/EC2",
          metricName: "StatusCheckFailed_Instance",
          comparisonOperator: "GreaterThanOrEqualToThreshold",
          threshold: 1,
          statistic: "Maximum",
          dimensions: {
            InstanceId: props.instanceId,
          },
          alarmActions: [
            pulumi
              .interpolate`arn:aws:swf:${currentRegion.name}:${currentAccount.accountId}:action/actions/AWS_EC2.InstanceId.Reboot/1.0`,
          ],
          tags: mergeTags(props.tags, {
            Name: pulumi.concat(instanceName, "-status-check-failed-instance"),
          }),
        },
        {
          parent: this,
        },
      );
    }

    if (props.metricAlarms?.systemStatusCheck !== false) {
      this.metricAlarms.systemStatusCheck = new aws.cloudwatch.MetricAlarm(
        `${name}-system-status-check`,
        {
          name: pulumi.concat(props.instanceId, "-status-check-failed-system"),
          evaluationPeriods: 2,
          period: 60,
          namespace: "AWS/EC2",
          metricName: "StatusCheckFailed_System",
          comparisonOperator: "GreaterThanOrEqualToThreshold",
          threshold: 1,
          statistic: "Maximum",
          dimensions: {
            InstanceId: props.instanceId,
          },
          alarmActions: [
            pulumi
              .interpolate`arn:aws:swf:${currentRegion.name}:${currentAccount.accountId}:action/actions/AWS_EC2.InstanceId.Reboot/1.0`,
          ],
          tags: mergeTags(props.tags, {
            Name: pulumi.concat(instanceName, "-status-check-failed-system"),
          }),
        },
        {
          parent: this,
        },
      );
    }
  }
}

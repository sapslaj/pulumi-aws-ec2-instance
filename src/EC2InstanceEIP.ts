import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as time from "@pulumiverse/time";

import { mergeTags } from "./utils";

export interface EC2InstanceEIPConfig extends Omit<aws.ec2.EipArgs, "instance" | "vpc"> {
  attachDuration?: pulumi.Input<string>;
  detachDuration?: pulumi.Input<string>;
}

export interface EC2InstanceEIPProps extends EC2InstanceEIPConfig {
  instanceId: pulumi.Input<string>;
  instanceName?: pulumi.Input<string>;
}

export class EC2InstanceEIP extends aws.ec2.Eip {
  attachSleep: time.Sleep;

  constructor(name: string, props: EC2InstanceEIPProps, opts?: pulumi.CustomResourceOptions) {
    let {
      instanceId,
      instanceName,
      attachDuration,
      detachDuration,
      tags,
      ...args
    } = props;

    if (instanceName) {
      tags = mergeTags(tags, {
        Name: instanceName,
      });
    }

    super(name, {
      domain: "vpc",
      instance: instanceId,
      tags,
      ...args,
    }, opts);

    if (!attachDuration) {
      attachDuration = "10s";
    }

    this.attachSleep = new time.Sleep(name, {
      createDuration: attachDuration,
      destroyDuration: detachDuration,
    }, {
      parent: this,
      dependsOn: [
        this,
      ],
    });
  }
}

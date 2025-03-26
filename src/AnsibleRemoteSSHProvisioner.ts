import * as command from "@pulumi/command";
import * as pulumi from "@pulumi/pulumi";
import { AnsibleProvisioner, AnsibleProvisionerProps } from "@sapslaj/pulumi-ansible-provisioner";
import { makeSetHostnameCommand } from "./ansible-utils";

export interface AnsibleRemoteSSHProvisionerConfig extends Omit<AnsibleProvisionerProps, "connection"> {
  setHostname?: boolean | pulumi.Input<string>;
  setHostnameCommand?: pulumi.Input<string>;
}

export interface AnsibleRemoteSSHProvisionerProps extends AnsibleRemoteSSHProvisionerConfig {
  connection: command.types.input.remote.ConnectionArgs;
  instanceName?: pulumi.Input<string>;
  defaultHostname?: pulumi.Input<string>;
}

export class AnsibleRemoteSSHProvisioner extends pulumi.ComponentResource {
  ansibleProvisioner: AnsibleProvisioner;
  setHostnameCommand?: command.remote.Command;

  constructor(name: string, props: AnsibleRemoteSSHProvisionerProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:AnsibleRemoteSSHProvisioner", name, {}, opts);

    const setHostnameCommand = makeSetHostnameCommand(props);
    if (setHostnameCommand) {
      this.setHostnameCommand = new command.remote.Command(`${name}-set-hostname`, {
        connection: props.connection,
        create: setHostnameCommand,
        update: setHostnameCommand,
        triggers: [
          setHostnameCommand,
          props.setHostname,
          props.setHostnameCommand,
        ],
      }, {
        parent: this,
      });
    }

    this.ansibleProvisioner = new AnsibleProvisioner(name, props, {
      parent: this,
    });
  }
}

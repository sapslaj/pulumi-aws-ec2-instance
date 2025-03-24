import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";

export interface EC2KeyPairConfig {
  createKeyPair?: boolean;
  createPublicKey?: boolean;
  createPrivateKey?: boolean;
  publicKey?: pulumi.Input<string>;
  privateKey?: pulumi.Input<string>;
  keyPairConfig?: Partial<aws.ec2.KeyPairArgs>;
  privateKeyConfig?: Partial<tls.PrivateKeyArgs>;
}

export interface EC2KeyPairProps extends EC2KeyPairConfig {}

export class EC2KeyPair extends pulumi.ComponentResource {
  keyPair?: aws.ec2.KeyPair;
  publicKey?: pulumi.Output<string>;
  privatekey?: pulumi.Output<string>;
  privateKeyResource?: tls.PrivateKey;

  constructor(name: string, props: EC2KeyPairProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2KeyPair", name, {}, opts);

    let privateKey: pulumi.Input<string> | undefined = props.privateKey;

    if (!privateKey && props.createPrivateKey !== false) {
      this.privateKeyResource = new tls.PrivateKey(name, {
        algorithm: "ED25519",
        ...props.privateKeyConfig,
      });
      privateKey = this.privateKeyResource.privateKeyOpenssh;
    }

    if (privateKey) {
      this.privatekey = pulumi.secret(privateKey);
    }

    let publicKey: pulumi.Input<string> | undefined = props.publicKey;

    if (!publicKey && props.createPublicKey !== false) {
      if (!privateKey) {
        throw new Error("privateKey must be specified when not generating a private key.");
      }
      publicKey = tls.getPublicKeyOutput({
        privateKeyOpenssh: privateKey,
      }).publicKeyOpenssh;
    }

    if (publicKey) {
      this.publicKey = pulumi.output(publicKey);
    }

    if (props.createKeyPair !== false) {
      if (!publicKey) {
        throw new Error("publicKey must be specified when not generating a public key.");
      }
      this.keyPair = new aws.ec2.KeyPair(name, {
        publicKey,
        ...props.keyPairConfig,
      });
    }
  }
}

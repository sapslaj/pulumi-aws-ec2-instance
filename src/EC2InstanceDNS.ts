import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export const DNSRecordType = {
  A: "A",
  AAAA: "AAAA",
  CNAME:  "CNAME",
} as const;
export type DNSRecordType = (typeof DNSRecordType)[keyof typeof DNSRecordType];

export const DNSTarget = {
  private: "private",
  public: "public",
}
export type DNSTarget = (typeof DNSTarget)[keyof typeof DNSTarget];

export const DNSProvider = {
  route53: "route53",
}
export type DNSProvider = (typeof DNSProvider)[keyof typeof DNSProvider];

export interface DNSProviderRoute53Config
  extends Omit<aws.route53.RecordArgs, "type" | "ttl" | "zoneId" | "records" | "aliases">
{
  hostedZoneName?: pulumi.Input<string>;
  hostedZoneId?: pulumi.Input<string>;
}

export interface EC2InstanceDNSConfig {
  hostname?: pulumi.Input<string>;
  domain?: pulumi.Input<string>;
  ttl?: pulumi.Input<number>;
  target?: DNSTarget;
  types?: DNSRecordType[];
  provider?: DNSProvider;
  route53?: DNSProviderRoute53Config;
}

export interface EC2InstanceDNSProps extends EC2InstanceDNSConfig {
  instance: aws.ec2.Instance;
  instanceName?: pulumi.Input<string>;
  eip?: aws.ec2.Eip;
}

export interface EC2InstanceDNSRoute53Result {
  hostedZoneName?: pulumi.Output<string>;
  hostedZoneId?: pulumi.Output<string>;
  records?: Partial<Record<DNSRecordType, aws.route53.Record>>;
}

export class EC2InstanceDNS extends pulumi.ComponentResource {
  instance: aws.ec2.Instance;
  eip?: aws.ec2.Eip;
  target: DNSTarget;
  ttl: pulumi.Input<number>;
  types: DNSRecordType[];
  domain?: pulumi.Input<string>;
  route53?: EC2InstanceDNSRoute53Result;
  instanceName?: pulumi.Input<string>;
  name: string;
  _hostname?: pulumi.Input<string>;

  constructor(name: string, props: EC2InstanceDNSProps, opts: pulumi.ComponentResourceOptions = {}) {
    super("sapslaj:pulumi-aws-ec2-instance:EC2InstanceDNS", name, {}, opts);

    this.name = name;
    this.instance = props.instance;
    this.eip = props.eip;
    this.target = props.target ?? DNSTarget.private;
    this.ttl = props.ttl ?? 60;
    this.types = props.types ?? [DNSRecordType.A];
    this.domain = props.domain;
    this._hostname = props.hostname;

    const provider = props.provider ?? DNSProvider.route53;

    if (provider === DNSProvider.route53) {
      this.route53 = this.createRoute53(name, props);
    }
  }

  get hostname(): pulumi.Input<string> {
    return this._hostname ?? pulumi.concat(
      this.instanceName ?? this.name,
      this.domain === undefined ? "" : ".",
      this.domain === undefined ? "" : this.domain,
    );
  }

  aRecords(): pulumi.Output<string[]> {
    if (this.target === DNSTarget.private) {
      return this.instance.privateIp.apply((v) => [v]);
    }

    if (this.eip !== undefined) {
      return this.eip.publicIp.apply((v) => [v]);
    }

    return this.instance.publicIp.apply((v) => [v]);
  }

  aaaaRecords(): pulumi.Output<string[]> {
    return this.instance.ipv6Addresses;
  }

  cnameRecords(): pulumi.Output<string[]> {
    if (this.target === DNSTarget.private) {
      return this.instance.privateDns.apply((v) => [v]);
    }

    return this.instance.publicDns.apply((v) => [v]);
  }

  createRoute53(name: string, props: EC2InstanceDNSProps): EC2InstanceDNSRoute53Result {
    let {
      hostedZoneName,
      hostedZoneId,
      ...args
    } = props.route53 ?? {};

    if (!hostedZoneName) {
      hostedZoneName = props.domain;
    }

    if (!hostedZoneId) {
      hostedZoneId = aws.route53.getZoneOutput({
        name: hostedZoneName,
      }).zoneId;
    }

    const records: Partial<Record<DNSRecordType, aws.route53.Record>> = {};

    if (this.types.includes(DNSRecordType.A)) {
      records[DNSRecordType.A] = new aws.route53.Record(`${name}-a`, {
        zoneId: hostedZoneId,
        type: "A",
        name: this.hostname,
        ttl: this.ttl,
        records: this.aRecords(),
        ...args,
      }, {
        parent: this,
      });
    }

    if (this.types.includes(DNSRecordType.AAAA)) {
      records[DNSRecordType.AAAA] = new aws.route53.Record(`${name}-aaaa`, {
        zoneId: hostedZoneId,
        type: "AAAA",
        name: this.hostname,
        ttl: this.ttl,
        records: this.aaaaRecords(),
        ...args,
      }, {
        parent: this,
      });
    }

    if (this.types.includes(DNSRecordType.CNAME)) {
      records[DNSRecordType.CNAME] = new aws.route53.Record(`${name}-cname`, {
        zoneId: hostedZoneId,
        type: "CNAME",
        name: this.hostname,
        ttl: this.ttl,
        records: this.cnameRecords(),
        ...args,
      }, {
        parent: this,
      });
    }

    return {
      hostedZoneId: pulumi.output(hostedZoneId),
      hostedZoneName: hostedZoneName !== undefined ? pulumi.output(hostedZoneName) : undefined,
      records,
    };
  }
}

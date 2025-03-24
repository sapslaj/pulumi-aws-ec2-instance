import * as pulumi from "@pulumi/pulumi";

export function deDoubleNegativeifyOptional<T>(
  transform: (t: pulumi.Unwrap<T>) => T,
  positiveProp: pulumi.Input<T> | undefined,
  negativeProp: pulumi.Input<T> | undefined,
  defaultValue?: T | undefined,
): pulumi.Output<T> | undefined {
  if (positiveProp !== undefined) {
    return pulumi.output(positiveProp).apply(transform);
  }
  if (negativeProp !== undefined) {
    return pulumi.output(negativeProp) as pulumi.Output<T>;
  }
  if (defaultValue !== undefined) {
    return pulumi.output(defaultValue) as pulumi.Output<T>;
  }
  return undefined;
}

export function deDoubleNegativeify<T>(
  transform: (t: pulumi.Unwrap<T>) => T,
  positiveProp: pulumi.Input<T> | undefined,
  negativeProp: pulumi.Input<T> | undefined,
  defaultValue: T,
): pulumi.Output<T> {
  if (positiveProp !== undefined) {
    return pulumi.output(positiveProp).apply(transform);
  }
  if (negativeProp !== undefined) {
    return pulumi.output(negativeProp) as pulumi.Output<T>;
  }
  return pulumi.output(defaultValue) as pulumi.Output<T>;
}

export function mergeTags(
  ...groups: (
    | pulumi.Input<{
      [key: string]: pulumi.Input<string>;
    }>
    | undefined
  )[]
): pulumi.Input<{
  [key: string]: pulumi.Input<string>;
}> {
  return pulumi.all(groups).apply((groups) => {
    let result: Record<string, string> = {};
    for (const group of groups) {
      if (group === undefined) {
        continue;
      }
      result = {
        ...result,
        ...group,
      };
    }
    return result;
  });
}

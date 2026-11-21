import { describe, expect, it } from 'vitest';

import { NOTHING_ASKED, cloudCommand } from './cloudCommand';

describe('the command that writes an inventory', () => {
  it('names the provider, what to read and where to write', () => {
    expect(
      cloudCommand({
        ...NOTHING_ASKED,
        provider: 'aws',
        profile: 'readonly',
        regions: 'sa-east-1, us-east-1',
        tags: 'env=prod team',
        name: 'shop',
      }),
    ).toEqual({
      command:
        'python3 scripts/export-cloud-inventory.py aws --profile readonly --region sa-east-1 --region us-east-1 --tag env=prod --tag team --name shop --output inventory.json',
      missing: [],
    });
  });

  it('says what a provider cannot be read without', () => {
    expect(cloudCommand({ ...NOTHING_ASKED, provider: 'aws' }).missing).toEqual(['regions']);
    expect(cloudCommand({ ...NOTHING_ASKED, provider: 'gcp' }).missing).toEqual(['project']);
    expect(cloudCommand({ ...NOTHING_ASKED, provider: 'oci' }).missing).toEqual([
      'compartment',
      'regions',
    ]);
    // What is missing has no place in the command: nothing a shell would misread.
    expect(cloudCommand({ ...NOTHING_ASKED, provider: 'aws' }).command).toBe(
      'python3 scripts/export-cloud-inventory.py aws --output inventory.json',
    );
  });

  it('asks each provider in its own terms', () => {
    expect(
      cloudCommand({
        ...NOTHING_ASKED,
        provider: 'gcp',
        project: 'shop-prod-1234',
        regions: 'southamerica-east1',
      }).command,
    ).toBe(
      'python3 scripts/export-cloud-inventory.py gcp --project shop-prod-1234 --region southamerica-east1 --output inventory.json',
    );
    expect(
      cloudCommand({
        ...NOTHING_ASKED,
        provider: 'oci',
        profile: 'DEFAULT',
        compartment: 'ocid1.compartment.oc1..aaaa',
        regions: 'sa-saopaulo-1',
      }).command,
    ).toBe(
      'python3 scripts/export-cloud-inventory.py oci --compartment ocid1.compartment.oc1..aaaa --profile DEFAULT --region sa-saopaulo-1 --output inventory.json',
    );
    // A profile is not something Google Cloud is asked by, nor a project AWS.
    expect(
      cloudCommand({ ...NOTHING_ASKED, provider: 'gcp', project: 'p', profile: 'x' }).command,
    ).not.toContain('--profile');
    expect(
      cloudCommand({ ...NOTHING_ASKED, provider: 'aws', regions: 'sa-east-1', project: 'p' })
        .command,
    ).not.toContain('--project');
  });

  it('quotes what a shell would read as more than one word', () => {
    const { command } = cloudCommand({
      ...NOTHING_ASKED,
      provider: 'aws',
      regions: 'sa-east-1',
      name: "Ana's shop",
      profile: '$(reboot)',
    });
    expect(command).toContain(`--name 'Ana'\\''s shop'`);
    expect(command).toContain(`--profile '$(reboot)'`);
    // A tag whose value has a space is one argument when it is written in quotes.
    expect(
      cloudCommand({
        ...NOTHING_ASKED,
        provider: 'aws',
        regions: 'sa-east-1',
        tags: '"team=shop floor" env=prod',
      }).command,
    ).toContain(`--tag 'team=shop floor' --tag env=prod`);
  });
});

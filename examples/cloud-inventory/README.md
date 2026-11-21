# Cloud inventories

The same small shop as each of the three collectors would write it from an
account: `topologies/aws-shop.json`, `topologies/gcp-shop.json` and
`topologies/oci-shop.json`. Everything in them is fictional. The directory
is laid out as a workspace, so each file is read as a platform:

```bash
cargo run -p aegis-server -- check-workspace examples/cloud-inventory
AEGIS_WORKSPACE=examples/cloud-inventory cargo run -p aegis-server
```

Or, with the application already open: **⋯**, **Import or export files**,
drop one of the files, choose what to bring, **Apply**.

The files are not written by hand. Each is what its collector writes from
the answers its own tests hold (`scripts/test_cloud_inventory_*.py`), and a
test fails when the two part. To write them again after changing a
collector:

```bash
AEGIS_UPDATE_EXAMPLES=1 python3 -B -m unittest discover -s scripts -p 'test_cloud_inventory_*.py'
```

Things to try:

- Drop `aws-shop.json` on the dialog and turn on **Only what a connection
  touches**: the bastion and a table nothing is stated to read are left out,
  and the count says so.
- Choose the tag `env`, then `prod`, then **Also what leads to them and what
  they lead to**: what nobody tagged on the same paths comes too.
- Turn off **Draw connections from network rules** and watch the databases
  lose every connection: nothing but a security group said who reaches them.
- Apply it, then **Explore an incident** and start the DDoS surge. The
  distribution is the edge router, the balancer the gateway, GuardDuty the
  monitor. The credential stuffing scenario says which role the account has
  nothing to be.
- Add a `selection` to a copy by hand
  (`{ "regions": ["sa-east-1"], "connectedOnly": true }`) and check it from
  the command line.

[docs/INVENTORY.md](../../docs/INVENTORY.md) has the format, what a
selection does, and what an inventory cannot say.

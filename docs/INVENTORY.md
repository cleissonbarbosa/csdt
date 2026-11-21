# Cloud inventories

A cloud inventory is what a provider lists of an account, written to one
file by a script you run and read by AEGIS as a platform: the resources it
has a piece for, and the connections the provider itself states between
them. It is the quick way to stand your own AWS, Google Cloud or Oracle
Cloud account on the model.

What comes out is a [topology](WORKSPACE.md#topology) like any other, and
it is `synthetic`: the platform has the account's shape, and everything the
simulation shows on it is computed. An inventory states no traffic, no
latency and no capacity, so those are defaults, named as such in the
platform's own description. Read [What an inventory cannot
say](#what-an-inventory-cannot-say) before reading what breaks.

Nothing in AEGIS reaches a cloud. The server, the engine and the page hold
no cloud SDK and no credential; the file is text, read like a Compose file
is. The script that writes it is yours to run, on your machine, with your
own access, and it only reads.

## From an account to a platform

1. **Write the file.** In the application: **⋯**, **Import or export
   files**, **Get an inventory of a cloud account, to import**. Choose the
   provider, say what to read, and copy the command it writes. Or write it
   yourself ([Writing one](#writing-one)):

   ```bash
   python3 scripts/export-cloud-inventory.py aws \
     --profile readonly --region sa-east-1 --name shop-prod \
     --output inventory.json
   ```

2. **Drop it on the dialog.** The file is checked as every file is, and a
   panel says what it holds: how many resources, in which regions and
   networks, of which kinds, with which tags.
3. **Choose what to bring, and apply.** Each choice is written into the
   file's own `selection` and the file is read again, so the counts are the
   server's. **Apply** makes it the platform; **Save as one file** then
   gives you the topology it became, to edit by hand.

Before applying, **How would an incident go on each?** in the same dialog
runs a bundled scenario on the platform in use and on the one the file
describes ([WORKSPACE.md](WORKSPACE.md#an-incident-on-both-platforms)).

The same file works without the dialog. Put it in a workspace's
`topologies/` and it is read when the server starts; a selection is then
written by hand, in the file:

```bash
cargo run -p aegis-server -- check-workspace examples/cloud-inventory
AEGIS_WORKSPACE=examples/cloud-inventory cargo run -p aegis-server
```

On the static site the file is read by the same code, in the tab, and goes
nowhere.

## What is read from the file

| From the file                                 | In the topology                                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| each resource the selection brings            | a node with the resource's `id`, `name` and `type`; its description says what the provider calls it and, for a group, how many it stands for                         |
| its `region`                                  | the node's region; `global` is the provider's edge, for what is in no region                                                                                         |
| a relation with basis `routing`               | a `route` connection; what a router sends on is shared evenly between its routes                                                                                     |
| a relation with basis `event`                 | `publish` into a queue, `consume` out of one or from any other source of events                                                                                      |
| a relation with basis `declared` or `network` | a connection read by what it leads to: `data` to a database or a store, `publish` to a queue, `auth` to an authentication service, `call` to anything else           |
| `public` resources                            | where `clients` enter: each public resource no other public resource routes to. With none stated public, each resource that leads somewhere and is led to by nothing |
| the file's `name`                             | the platform's id and name                                                                                                                                           |

Two nodes are added that the file does not list, as a Compose file is given
one: `clients`, which stands for whoever uses the platform and sends the
default 100 requests a second, shared evenly between the entries; and
`unknown-sources`, idle at rest, which a scenario sends hostile traffic
through. Both stand at the edge.

Two statements of the same connection are one connection, read as the
stronger says, in this order: `routing`, `event`, `declared`, `network`.
That is why a panel can say "25 of 28 connections drawn" with nothing left
out: three were stated twice.

**A topology is followed one way.** Where the connections the file states
run in a circle (two groups that admit each other, a queue whose consumer
publishes back to it), the connection that would close the circle is left
out, weakest basis first and then in the file's order, and the platform's
description names each one: "Left out so that calls run one way: orders-db
to checkout". To choose another, leave one out by hand with `without`.

**Roles** are named where the file has something to be one, so the bundled
scenarios run where they can and say which role is missing where they
cannot ([WORKSPACE.md](WORKSPACE.md#roles)):

| Role                             | Points at                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `partnerClient`, `attackSource`  | `clients` and `unknown-sources`                                                                                                  |
| `edgeRouter`                     | the first network gateway at the edge (`global`), or else the first one clients enter at                                         |
| `primaryGateway`                 | the first API gateway or load balancer the edge router routes to, or else the first API gateway, or else the first load balancer |
| `primaryAuth`, `primaryDatabase` | the first authentication service; the first database                                                                             |
| `securityMonitor`                | the first security monitor                                                                                                       |
| `outageRegion`, `failoverRegion` | the first two regions with an API gateway or a load balancer each                                                                |

An account with a distribution, a load balancer behind it and a threat
detector has what the bundled DDoS surge asks for, and it runs on the
import as it is. The collectors read no Cedar authorizer (Amazon Verified
Permissions is not read), so the two scenarios that ask for one do not.

## Choosing what to bring

A file may carry a `selection`. Without one, everything is brought. Each
field left out asks for everything; every field given must hold.

| Field           | Brings                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `regions`       | only resources in these regions                                                                                                              |
| `networks`      | only resources in these networks; `null` among them stands for the resources that are in none                                                |
| `kinds`         | only resources of these kinds                                                                                                                |
| `tags`          | only resources that carry every tag listed: `{ "key": "env", "values": ["prod", "staging"] }`, or the key alone with no `values`             |
| `name`          | only resources whose name has this in it, whatever the case                                                                                  |
| `alongPaths`    | also what leads to the resources chosen above and what they lead to, following the connections both ways                                     |
| `connectedOnly` | not what no connection touches. A security monitor stays: it watches, and nothing calls it                                                   |
| `bases`         | only connections stated in these ways (`routing`, `event`, `declared`, `network`); the others are not drawn, and the description counts them |
| `exclude`       | not these resources, by id, whatever else is asked                                                                                           |
| `without`       | not these connections: `{ "from": "cdn", "to": "assets" }`                                                                                   |

They apply in that order: the filters choose, `alongPaths` adds what is on
a path through the chosen (never through a resource left out by hand),
`exclude` takes away, the connections between what is left are drawn, and
`connectedOnly` then leaves out what none of them touches.

`alongPaths` is what makes a tag useful. Tags never reach everything: ask
for `app=shop` and the balancer in front of it and the database behind it,
which nobody tagged, come with it; another application's services that
share the database do not.

A selection that leaves nothing, or that names a resource the file does not
list, is refused with the reason. More than 1 998 resources or 20 000
connections is more than a topology holds: the file is still surveyed, and
the answer says to narrow it.

## What an inventory cannot say

- **How much traffic there is, how it is shared, how slow anything is.**
  The 100 requests a second, the even share between entries and between a
  router's routes, and every latency are the converter's defaults. To give
  the platform the rates a real incident had, draft one from an [incident
  capture](CAPTURES.md#drafting-a-platform-from-a-capture) instead, or save
  the topology and write `baseRps` and the connection weights you know.
- **A capacity.** None is given: each service has the model's default
  headroom over its load at rest. Give `capacityRps` to the services whose
  limits you know before reading "would have prevented it".
- **Who calls whom, where the provider does not stand between them.** One
  service calling another over HTTP is in no inventory. A connection is
  drawn only from a statement the file holds, and says of which kind.
  Declare the ones you know when the file is written (`--relation`), or
  read them from traces with a capture exporter.
- **That a permission is used.** A network rule that admits one group to
  another is drawn as a connection because nothing else says who reaches a
  database; it is a permission to reach, not a call that was seen. The
  description says how many connections rest on one, and
  `"bases": ["routing", "event", "declared"]` draws none of them.
- **What load a service takes off.** A rate limit, a filter of suspicious
  traffic and autoscaling are [stated by a topology
  file](WORKSPACE.md#what-a-service-does-about-load); an inventory states
  none of them. Add them to the saved topology.

## The format

One JSON file, version 1, described by
[`schemas/v1/inventory.schema.json`](../schemas/v1/inventory.schema.json).
The reader refuses a file that breaks a rule rather than repairing it, and
names the rule.

| Field         | Meaning                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `kind`        | `"aegis-cloud-inventory"`: how a `.json` file is told from a topology                                                      |
| `version`     | `1`                                                                                                                        |
| `provider`    | `aws`, `gcp` or `oci`                                                                                                      |
| `name`        | 1–64 characters: the platform's name and, with anything but letters, digits, `.`, `_` and `-` replaced, its id             |
| `collectedAt` | optional, at most 64 characters: when it was read, shown as written                                                        |
| `resources`   | 1–10 000 of `{ id, name, type, native, region, network?, tags?, public?, members? }`                                       |
| `relations`   | up to 50 000 of `{ from, to, basis, evidence? }`                                                                           |
| `selection`   | optional: [which part is brought](#choosing-what-to-bring)                                                                 |
| `notes`       | up to 40 strings of at most 1 280 characters: what the collector could not read or did not, shown as written in the dialog |

- **`id`** is 1–64 letters, digits, `.`, `_` or `-`, unique, and neither
  `clients` nor `unknown-sources`. It is the node's id. A collector makes it
  from the resource's name; it is never the provider's own identifier.
- **`type`** is one of the kinds of service of a topology, except
  `external-client`: a file lists what the account holds, not who uses it.
  **`native`** is what the provider calls the resource
  (`AWS::RDS::DBCluster`), shown as written.
- **`region`** is an id like `id`. **`network`** names the network the
  resource is placed in, where it is in one.
- **`tags`** are at most 64 pairs, a key of at most 128 characters and a
  value of at most 256. They are used to select and are not copied into the
  topology.
- **`public`** says the provider states the resource as reachable from
  outside. **`members`** says how many the one piece stands for.
- A **relation** runs between two different resources the file lists.
  **`basis`** says what states it; **`evidence`**, at most 256 characters,
  says it in the collector's words (`target group checkout`).

After an import only the topology is kept: no tag, no network, no
selection, no note. The file itself is not stored.

## Writing one

`scripts/export-cloud-inventory.py` is a tool for the operator, run on the
operator's machine. AEGIS never runs it, and it is not an
[integration](INTEGRATIONS.md): the server and the page never call it or
anything it reads from. It uses only Python 3's standard library and the
provider's own CLI, which must be installed and signed in; it calls the CLI
with a list of arguments, never through a shell. It writes a new file and
refuses to overwrite one, keeps within the limits above (and within the
4 MiB the server reads in one file), and exits 0 when it wrote the file, 1
with `Inventory failed: …` when it could not, and 2 for a usage error.
`<provider> --help` lists a provider's options and the kinds.

Every provider takes these:

```text
  --name shop-prod            # the platform's name in AEGIS; it need not be the account's
  --tag env=prod              # write only resources carrying this tag; repeatable; --tag env for the key alone
  --tag-key env               # write only this tag key of each resource; repeatable; without it every tag is written
  --type orders-db=database   # declare the kind of the one resource with exactly this name; repeatable
  --relation checkout=orders  # declare a connection between two resources by their names; repeatable
  --no-network-rules          # do not read network rules: no connection is drawn from a permission
  --output inventory.json     # a new file
```

**Every call is a read.** Each collector lists the operations it may call
(`READS`), a test holds what it calls to that list, and every one of them
is a list, a describe or a get.

**A read that is refused is noted, and the rest is read.** A profile that
may not list queues gives an inventory without queues and a note that says
so, with the provider's short name for the refusal (`AccessDenied`) and
nothing else of what it said: the whole of it is printed to your terminal.
If every read is refused nothing is written.

**An inventory can name your systems.** It holds resource names, tags,
region and network names, and how they connect. It does not hold the
provider's own identifiers: no account id, ARN, project id, OCID, address
or credential, and a test of each collector checks that. A name or a tag
you wrote may still say more than you want shared; read the file, or
write fewer tags with `--tag-key`. Once applied, a platform is served to
whoever can reach the API ([SECURITY.md](SECURITY.md#workspace)).

**The collectors were written from the providers' references, not against
an account.** Their tests answer in the shapes the references document.
The first run against a real account may meet a shape they do not cover: a
field that is missing is treated as absent, and a failure names the read
that failed. A report of one is welcome.

A resource is listed once: the instances of a group as the group, the
members of a database cluster as the cluster. An instance is `public` only
with an address of its own and a rule that admits anyone on port 80 or 443;
a bastion open on 22 is not where clients enter.

### AWS

Needs the AWS CLI v2, recent enough to list buckets by region. It is called
with the profile you name (`--profile`) or, without it, the CLI's default
credential chain. `--region` is required and may be repeated to read
several regions into one inventory.

```bash
python3 scripts/export-cloud-inventory.py aws \
  --profile readonly \
  --region sa-east-1 \
  --name shop-prod \
  --output inventory.json
```

| It reads                                                                           | And writes                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| load balancers, their target groups and target health                              | an application or a network balancer as a load balancer, `public` when internet-facing; `routing` to what its target groups hold                                 |
| Auto Scaling groups and running instances                                          | a group as one virtual machine with its count; an instance in no group as a virtual machine of its own                                                           |
| ECS clusters and services; EKS clusters                                            | a service as a container with its desired count, behind the target groups it registers with; an EKS cluster as one Kubernetes cluster                            |
| Lambda functions and event source mappings                                         | a function as serverless; `event` from the queue, stream or table a mapping reads                                                                                |
| REST and HTTP APIs, their integrations and authorizers; Cognito user pools         | an API as an API gateway, `public` unless private; `routing` to the function or balancer an integration names; `declared` to the user pool an authorizer asks    |
| SQS queues and their redrive policy; SNS topics and subscriptions; Kinesis streams | a queue as a message queue, a topic and a stream as an event stream; `declared` to a dead-letter queue; `event` from a topic to the queue or function subscribed |
| RDS clusters and instances, DynamoDB tables, ElastiCache                           | each as a database, ElastiCache as a cache; a cluster with its member count                                                                                      |
| S3 buckets of each region read                                                     | storage                                                                                                                                                          |
| CloudFront distributions (once, in no region)                                      | a network gateway at the edge, `public`; `routing` to the balancer, API or bucket an origin names by its own AWS name                                            |
| GuardDuty detectors                                                                | one security monitor for a region that has one                                                                                                                   |
| VPCs and security groups                                                           | a network's name; a rule that admits one group to another as a `network` relation between their members                                                          |
| tags, from each service or the tagging API                                         | each resource's `tags`                                                                                                                                           |

Not read: Lambda function URLs, EventBridge rules, Step Functions, what
runs inside an EKS cluster, and an origin or an integration named by a DNS
name of your own. Declare such a connection with `--relation`.

A least-privilege policy for the profile is these actions. They are lists
and descriptions that take no resource, so `Resource` is `"*"`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AegisInventoryRead",
      "Effect": "Allow",
      "Action": [
        "tag:GetResources",
        "ec2:DescribeVpcs",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeInstances",
        "autoscaling:DescribeAutoScalingGroups",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "eks:ListClusters",
        "eks:DescribeCluster",
        "lambda:ListFunctions",
        "lambda:ListEventSourceMappings",
        "apigateway:GET",
        "cognito-idp:ListUserPools",
        "sqs:ListQueues",
        "sqs:GetQueueAttributes",
        "sns:ListTopics",
        "sns:ListSubscriptions",
        "rds:DescribeDBClusters",
        "rds:DescribeDBInstances",
        "dynamodb:ListTables",
        "elasticache:DescribeReplicationGroups",
        "elasticache:DescribeCacheClusters",
        "kinesis:ListStreams",
        "s3:ListAllMyBuckets",
        "guardduty:ListDetectors",
        "cloudfront:ListDistributions"
      ],
      "Resource": "*"
    }
  ]
}
```

### Google Cloud

Needs the gcloud CLI, signed in. It is called as whoever gcloud is signed in
as, or with the named configuration you give (`--configuration`), and with
`--quiet`, so that it asks nothing and enables nothing. `--project` is
required and is not written to the file. `--region` is optional and may be
repeated: with it, only those regions and what is in none are kept; without
it every region is kept, and Memorystore, which is listed region by region,
is not read.

```bash
python3 scripts/export-cloud-inventory.py gcp \
  --project shop-prod-1234 \
  --region southamerica-east1 \
  --name shop-gcp \
  --output inventory.json
```

| It reads                                                                                              | And writes                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| forwarding rules, target proxies, URL maps, backend services and buckets, and network endpoint groups | one load balancer for each URL map, at the edge when it is global, `public` when a forwarding rule that leads to it is external; `routing` to the group, service, function or bucket its backends reach. A rule straight to a backend service or a target pool is a load balancer too |
| managed instance groups and instances                                                                 | a group as one virtual machine with its size; a running instance in no group as a virtual machine of its own                                                                                                                                                                          |
| Cloud Run services and Cloud Functions                                                                | each as serverless, `public` when its ingress admits all traffic; `declared` to the Cloud SQL instances a service names; `event` from the topic or bucket that triggers a function                                                                                                    |
| Pub/Sub topics and subscriptions                                                                      | a topic as an event stream; `event` to the service a push subscription delivers to; `declared` to a dead-letter topic. A pull subscription states no consumer, and none is drawn                                                                                                      |
| Cloud SQL, Spanner, Firestore, and Memorystore in the regions given                                   | each as a database, Memorystore as a cache                                                                                                                                                                                                                                            |
| Cloud Storage buckets                                                                                 | storage                                                                                                                                                                                                                                                                               |
| GKE clusters                                                                                          | one Kubernetes cluster for each cluster; the groups and instances of its node pools are the cluster                                                                                                                                                                                   |
| firewall rules                                                                                        | an ingress rule that allows one network tag, or one service account, to reach another as a `network` relation between the instances that carry them                                                                                                                                   |
| labels                                                                                                | each resource's `tags`. A balancer carries the labels of its forwarding rules, and a group those all its instances share, since neither has labels of its own                                                                                                                         |

Not read: Identity Platform, API Gateway and Apigee and what they send on
to, App Engine, Eventarc
triggers other than a function's own, Cloud Tasks and Scheduler, Security
Command Center, proxy Network Load Balancers, the instances of a target pool
and of an unmanaged instance group, the endpoints of a zonal network
endpoint group (so container-native load balancing draws no route), firewall
policies and rules that deny, and what runs inside a GKE cluster. Declare
such a connection with `--relation`.

A global load balancer is listed as a load balancer, not as the network
gateway at the edge, and no security monitor is read. The bundled flood asks for a network gateway at the edge in front
of a gateway, and every bundled scenario names a monitor, so on a Google
Cloud inventory they say which role is missing; write a scenario for the
platform, or ask [where it gives](WORKSPACE.md#where-the-platform-gives).

The least access is a predefined role for each service that has one which
reads no data, and one permission in a custom role for Firestore, whose own
viewer role also reads documents. With your own user credentials gcloud may
also need `serviceusage.services.use` on the project it bills the calls to.

```text
roles/compute.viewer
roles/container.clusterViewer
roles/cloudfunctions.viewer
roles/run.viewer
roles/pubsub.viewer
roles/cloudsql.viewer
roles/redis.viewer
roles/spanner.viewer
roles/storage.bucketViewer
datastore.databases.list
```

### Oracle Cloud

Needs the OCI CLI, configured. It is called with the profile you name
(`--profile`) or, without it, the CLI's default one; an authentication the
CLI is told of in its own environment (`OCI_CLI_AUTH`) is used as it is.
`--compartment` (the compartment's OCID) and `--region` are required; the
compartments under the one named are not read, and neither OCID is written
to the file. Where the networks and their security groups are kept in a
compartment of their own, name it with `--network-compartment` (repeatable):
only the networks are read there.

```bash
python3 scripts/export-cloud-inventory.py oci \
  --profile DEFAULT \
  --compartment ocid1.compartment.oc1..aaaa \
  --region sa-saopaulo-1 \
  --name shop-oci \
  --output inventory.json
```

| It reads                                                              | And writes                                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| load balancers and network load balancers, with their backend sets    | each as a load balancer, `public` only where the provider says it is not private; `routing` to the resource that holds a backend's address in the balancer's own network              |
| instance pools and their instances; running instances and their VNICs | a pool as one virtual machine with its size; a running instance in no pool as a virtual machine of its own, `public` with a public address and a rule that admits anyone on 80 or 443 |
| OKE clusters and their node pools                                     | one Kubernetes cluster for each; its worker nodes are the cluster                                                                                                                     |
| container instances                                                   | a container each                                                                                                                                                                      |
| function applications and their functions                             | serverless                                                                                                                                                                            |
| API gateways and their deployments                                    | an API gateway, `public` when its endpoint is; `routing` to the function a route sends to, or to the resource that holds the address an HTTP route names                              |
| streams and queues                                                    | a stream as an event stream, a queue as a message queue                                                                                                                               |
| Autonomous Databases, DB systems, MySQL systems and NoSQL tables      | a database each                                                                                                                                                                       |
| Object Storage buckets                                                | storage                                                                                                                                                                               |
| VCNs, subnets, network security groups and their rules                | a network's name; an ingress rule whose source is another group as a `network` relation between their members                                                                         |
| freeform and defined tags                                             | each resource's `tags`, a defined one as `namespace.key`. The tags Oracle adds itself, and any whose value is an OCID, are left out                                                   |

Not read: Cloud Guard, identity domains, Notifications topics, Events rules,
Service Connector Hub, what runs inside an OKE cluster, security lists, the
VNICs of a container instance, and a backend named by a host name or held in
another network. An instance pool is taken to be in the network security
groups of its first running instance. No `event` or `declared` relation
comes from an Oracle Cloud read: declare the ones you know with
`--relation`.

A running instance costs one more read for each VNIC it has, and a pool one
for its first instance only; past 500 such reads in a region an instance is
still listed, without its groups and addresses, and the file says how many.

The least access is these statements, with `<group>` the group the profile's
user is in and `<compartment>` the compartment read (and, for the four
network statements, any `--network-compartment`). Listing a group's rules
takes `use`, narrowed to that one permission.

```text
Allow group <group> to inspect vcns in compartment <compartment>
Allow group <group> to inspect subnets in compartment <compartment>
Allow group <group> to read network-security-groups in compartment <compartment>
Allow group <group> to use network-security-groups in compartment <compartment> where request.permission='NETWORK_SECURITY_GROUP_LIST_SECURITY_RULES'
Allow group <group> to read instances in compartment <compartment>
Allow group <group> to inspect vnic-attachments in compartment <compartment>
Allow group <group> to inspect vnics in compartment <compartment>
Allow group <group> to read instance-pools in compartment <compartment>
Allow group <group> to inspect clusters in compartment <compartment>
Allow group <group> to read cluster-node-pools in compartment <compartment>
Allow group <group> to inspect compute-container-instances in compartment <compartment>
Allow group <group> to inspect load-balancers in compartment <compartment>
Allow group <group> to inspect network-load-balancers in compartment <compartment>
Allow group <group> to inspect fn-app in compartment <compartment>
Allow group <group> to inspect fn-function in compartment <compartment>
Allow group <group> to read api-gateways in compartment <compartment>
Allow group <group> to read api-deployments in compartment <compartment>
Allow group <group> to inspect streams in compartment <compartment>
Allow group <group> to inspect queues in compartment <compartment>
Allow group <group> to inspect autonomous-databases in compartment <compartment>
Allow group <group> to inspect db-systems in compartment <compartment>
Allow group <group> to inspect mysql-instances in compartment <compartment>
Allow group <group> to inspect nosql-tables in compartment <compartment>
Allow group <group> to inspect buckets in compartment <compartment>
```

### Tests

```bash
python3 -B -m unittest discover -s scripts -p 'test_cloud_inventory_*.py'
cargo test -p aegis-server --test inventory
```

The collectors' tests run no CLI: each hands its collector a fake that
answers as the provider's reference documents. Each also holds a file of
`examples/cloud-inventory/topologies/` to what its collector writes from
those answers, and a Rust test loads every one of those files through the
reader and the engine. So the collectors and the reader are held to each
other, and to the published schema.

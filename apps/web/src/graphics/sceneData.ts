import type {
  EdgeColumns,
  InfrastructureEdge,
  InfrastructureNode,
  NodeColumns,
  Region,
  RegionStatus,
} from '@aegis/contracts';

// The scene draws a graph. It does not need the simulation model or its bounds.
export type SceneNode = Pick<
  InfrastructureNode,
  'id' | 'name' | 'serviceType' | 'region' | 'tier'
> & {
  metrics: Pick<InfrastructureNode['metrics'], 'health' | 'throughputRps'>;
};

export interface SceneTopology {
  id: string;
  regions: Pick<Region, 'id' | 'name' | 'kind'>[];
  nodes: SceneNode[];
  edges: (Pick<InfrastructureEdge, 'id' | 'source' | 'target' | 'relationship'> & {
    metrics: Pick<InfrastructureEdge['metrics'], 'trafficRps' | 'errorRate'>;
  })[];
}

export interface SceneFrame {
  nodes: Pick<NodeColumns, 'health' | 'throughputRps'>;
  edges: Pick<
    EdgeColumns,
    'trafficRps' | 'errorRate' | 'rejectedRps' | 'suspiciousRps' | 'securityStatus'
  >;
  regions: Pick<RegionStatus, 'id' | 'health'>[];
}

export type Zone = {
  id: string; name: string; province: string; district: string; lat: number; lng: number;
  pea: number; businesses: number; activity: string; digital: number; points: number;
  distance: number; rural: boolean; segment: string; demand: number; coverage: number;
  gap: number; priority: number;
};
export type Analyst = {
  id: string; name: string; base: string; province: string; maturity: number; tenure: number;
  training: number; disbursements: number[]; newClients: number[]; par30: number[];
  referrals: number[]; mentoring: number[]; concentration: number[]; blindClients: number[];
};
export type Assumptions = {
  noise: number;
  ruralPar: number;
  tenureQuality: number;
  matureNewClient: number;
  volumeParDelta: number;
  volumeConcentrationDelta: number;
};
const provinces = [
  { name: 'Trujillo', lat: -8.1116, lng: -79.0288 },
  { name: 'Virú', lat: -8.4167, lng: -78.75 },
  { name: 'Ascope', lat: -7.714, lng: -79.107 },
  { name: 'Chepén', lat: -7.227, lng: -79.43 },
  { name: 'Pacasmayo', lat: -7.4, lng: -79.57 },
  { name: 'Otuzco', lat: -7.9, lng: -78.58 },
  { name: 'Sánchez Carrión', lat: -7.81, lng: -78.05 },
  { name: 'Pataz', lat: -8.27, lng: -77.3 },
  { name: 'Santiago de Chuco', lat: -8.14, lng: -78.17 },
  { name: 'Gran Chimú', lat: -7.59, lng: -78.66 },
  { name: 'Julcán', lat: -8.04, lng: -78.49 },
  { name: 'Bolívar', lat: -7.18, lng: -77.7 },
];
const districts = ['Centro', 'El Porvenir', 'La Esperanza', 'Florencia de Mora', 'Huanchaco', 'Laredo', 'Moche', 'Chao', 'Guadalupe', 'Pacanga', 'Sinsicap', 'Cachicadán'];
const activities = ['Comercio', 'Agro', 'Servicios', 'Manufactura'];
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = <T,>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
export function createModel(seed: number, assumptions: Assumptions) {
  const r = rng(seed);
  const zones: Zone[] = Array.from({ length: 60 }, (_, i) => {
    const prov = provinces[i % provinces.length];
    const rural = i % 5 !== 0 && i % 7 !== 0;
    const pea = Math.round((rural ? 850 : 2600) + r() * (rural ? 4100 : 12800));
    const businesses = Math.round(pea * (0.045 + r() * 0.085));
    const digital = Math.round(clamp((rural ? 25 : 53) + r() * 44 + (r() - .5) * assumptions.noise));
    const points = Math.floor(r() * (rural ? 2.3 : 5.8));
    const distance = Math.round(((rural ? 6 : 1.2) + r() * (rural ? 27 : 8)) * 10) / 10;
    const activity = pick(activities, r);
    const activityPotential = activity === 'Agro' ? 7 : activity === 'Manufactura' ? 6 : activity === 'Comercio' ? 5 : 4;
    const demand = clamp(Math.round(pea / 180 + businesses / 8 + digital * .32 + activityPotential + (r() - .5) * assumptions.noise));
    const coverage = clamp(Math.round(points * 12 + 35 / (distance + 1)));
    const gap = clamp(Math.round(demand - coverage + 50));
    const name = `${districts[i % districts.length]} ${prov.name}`;
    return { id: `Z-${String(i + 1).padStart(2, '0')}`, name, province: prov.name, district: districts[i % districts.length], lat: prov.lat + (r() - .5) * (rural ? .72 : .24), lng: prov.lng + (r() - .5) * (rural ? .76 : .3), pea, businesses, activity, digital, points, distance, rural, segment: 'Servicios emergentes', demand, coverage, gap, priority: 0 };
  }).map(z => ({ ...z, priority: clamp(Math.round(z.gap * .55 + (100 - z.digital) * .12 + (z.rural ? 12 : 0) + z.businesses / 45)) }));
  // Deterministic five-centroid k-means over normalized demand, coverage, digital access and distance.
  const features = (z: Zone) => [z.demand, z.coverage, z.digital, clamp(z.distance / 30 * 100)];
  const centers = [zones[2], zones[14], zones[26], zones[38], zones[50]].map(z => features(z));
  let labels = zones.map(() => 0);
  for (let round = 0; round < 12; round++) {
    labels = zones.map(z => {
      const f = features(z);
      return centers.reduce((best, center, idx) => {
        const distance = center.reduce((sum, v, j) => sum + (v - f[j]) ** 2, 0);
        const bestDistance = centers[best].reduce((sum, v, j) => sum + (v - f[j]) ** 2, 0);
        return distance < bestDistance ? idx : best;
      }, 0);
    });
    centers.forEach((center, idx) => {
      const members = zones.filter((_, i) => labels[i] === idx);
      if (members.length) centers[idx] = center.map((_, j) => members.reduce((sum, z) => sum + features(z)[j], 0) / members.length);
    });
  }
  const order = centers.map((center, idx) => ({ idx, access: center[1] + center[2] * .65 - center[3] * .12 })).sort((a, b) => a.access - b.access);
  const profileLabels = ['Frontera de inclusión', 'Agro rural', 'Servicios emergentes', 'Nodos de mercado', 'Comercio urbano'];
  const segmentByCluster = new Map(order.map((item, i) => [item.idx, profileLabels[i]]));
  zones.forEach((z, i) => {
    z.segment = segmentByCluster.get(labels[i]) ?? 'Servicios emergentes';
    const segmentPotential = z.segment === 'Frontera de inclusión' ? 8 : z.segment === 'Agro rural' ? 5 : 0;
    z.priority = clamp(Math.round(z.gap * .55 + (100 - z.digital) * .12 + (z.rural ? 12 : 0) + z.businesses / 45 - z.distance * .25 + segmentPotential));
  });
  const analysts: Analyst[] = Array.from({ length: 120 }, (_, i) => {
    const base = zones[i % zones.length], tenure = Math.round(4 + r() * 90), maturity = Math.round(15 + r() * 82), training = Math.round(35 + r() * 65);
    const monthly = (fn: (m: number) => number) => Array.from({ length: 12 }, (_, m) => Math.max(0, Math.round(fn(m) * (1 + (r() - .5) * assumptions.noise / 100))));
    const disbursements = monthly(() => (base.rural ? 32 : 55) + r() * (base.rural ? 45 : 120));
    const newClients = monthly(() => (base.rural ? 8 : 15) + r() * 24 - maturity * assumptions.matureNewClient / 100);
    const par30 = monthly(() => clamp((base.rural ? assumptions.ruralPar : 4.4) + r() * 5 - tenure * assumptions.tenureQuality / 170, 1, 22));
    const referrals = monthly(() => 2 + r() * 12);
    const mentoring = monthly(() => r() * 8);
    const concentration = monthly(() => 13 + r() * 35);
    const blindClients = monthly(() => (base.rural ? 4 : 1) + r() * 8);
    return { id: `A-${String(i + 1).padStart(3, '0')}`, name: `Analista ${String(i + 1).padStart(3, '0')}`, base: base.name, province: base.province, maturity, tenure, training, disbursements, newClients, par30, referrals, mentoring, concentration, blindClients };
  });
  return { zones, analysts };
}
export type IncentiveGate = { soft: number; hard: number; cap: number; pool: number };
export type IncentiveSummary = {
  cost: number;
  poolCompliant: boolean;
  maxBonus: number;
  productivity: number;
  quality: number;
  collaboration: number;
  development: number;
  inclusion: number;
  averagePar30: number;
  inclusionCustomers: number;
  equityGap: number;
  sustainability: number;
  scoresByProvince: { province: string; score: number }[];
};
const clampValue = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function estimateIncentive(
  analyst: Analyst,
  territory: Zone | undefined,
  weights: number[],
  gate: IncentiveGate,
) {
  const par = analyst.par30[11] ?? 0;
  const signals = [
    clampValue((analyst.disbursements[11] / 180) * 100),
    clampValue(100 - par * 4),
    clampValue((analyst.referrals[11] + analyst.mentoring[11] * 1.5) * 5),
    clampValue(analyst.training),
    clampValue((analyst.blindClients[11] / 12) * 100 + Math.max(0, (territory?.priority ?? 50) - 50) * 0.2),
  ];
  const score = signals.reduce((total, value, index) => total + value * (weights[index] ?? 0), 0) / 100;
  const qualityGate = par >= gate.hard ? 0 : par >= gate.soft ? 0.5 : 1;
  const bonus = Math.min(score * 7 * qualityGate, 700 * gate.cap);
  return { score, bonus, signals };
}

export function summarizeIncentives(
  analysts: Analyst[],
  zones: Zone[],
  weights: number[],
  gate: IncentiveGate,
): IncentiveSummary {
  const zoneByName = new Map(zones.map((zone) => [zone.name, zone]));
  const rows = analysts.map((analyst) => {
    const territory = zoneByName.get(analyst.base);
    const par = analyst.par30[11] ?? 0;
    const estimate = estimateIncentive(analyst, territory, weights, gate);
    return { analyst, par, ...estimate };
  });
  const cost = rows.reduce((sum, row) => sum + row.bonus, 0);
  const dimensions = [0, 1, 2, 3, 4].map((index) => mean(rows.map((row) => row.signals[index])));
  const provinces = [...new Set(rows.map((row) => row.analyst.province))];
  const scoresByProvince = provinces.map((province) => ({
    province,
    score: mean(rows.filter((row) => row.analyst.province === province).map((row) => row.score)),
  }));
  const equityGap = scoresByProvince.length
    ? Math.max(...scoresByProvince.map((row) => row.score)) - Math.min(...scoresByProvince.map((row) => row.score))
    : 0;
  const averagePar30 = mean(rows.map((row) => row.par));
  const quality = dimensions[1] ?? 0;
  const sustainability = clampValue(
    quality * 0.55 + dimensions[2] * 0.1 + dimensions[3] * 0.1 + dimensions[4] * 0.25 - equityGap * 0.2,
  );

  return {
    cost,
    poolCompliant: cost <= gate.pool,
    maxBonus: rows.length ? Math.max(...rows.map((row) => row.bonus)) : 0,
    productivity: dimensions[0] ?? 0,
    quality,
    collaboration: dimensions[2] ?? 0,
    development: dimensions[3] ?? 0,
    inclusion: dimensions[4] ?? 0,
    averagePar30,
    inclusionCustomers: analysts.reduce((sum, analyst) => sum + (analyst.blindClients[11] ?? 0), 0),
    equityGap,
    sustainability,
    scoresByProvince,
  };
}

export const fmt = (n: number) => new Intl.NumberFormat('es-PE').format(Math.round(n));
export const money = (n: number) => `S/. ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

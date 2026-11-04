import {writeFileSync} from 'node:fs';
import {references,evidence} from './references';
for(let i=0;i<references.length;i++)writeFileSync(`reports/fidelity-v4/e2-1/${references[i]!.name}-evidence.json`,JSON.stringify(evidence(i))+'\n');

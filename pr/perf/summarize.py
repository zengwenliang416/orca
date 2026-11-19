import json, sys
for path in sys.argv[1:]:
    r = json.load(open(path))
    print(f"== {path}\n   {r['meta']['uptime']} | {r['meta']['cores']} cores | head {r['meta']['repoHead'][:10]}")
    for k, v in r['summary']['mount'].items():
        f = lambda s: f"{s['median']} [{s['min']}-{s['max']}]" if s else '-'
        print(f"   mount {k:9} ready {f(v['toReadyMs']):24} react {f(v['reactRenderMs']):22} elements {v['elements']['median']:6} nodes {v['cardButtons']['median']:4} (fleet expects {v['expectedFleetNodes']}) problems {len(v['problems'])} errors {v['errors']}")
    for k, v in r['summary']['updates'].items():
        f = lambda s: f"{s['median']} [{s['min']}-{s['max']}]" if s else '-'
        p = v['pooledFlushMs']
        print(f"   update {k:8} run-median flush {f(v['runMedianFlushMs']):22} react {f(v['runMedianReactMs']):20} layout {f(v['runMedianLayoutMs']):16} pooled flush p50 {p['median']} p95 {p['p95']} (n={p['n']}) commits {v['profilerCommits']} elements {v['elements']['median']} problems {len(v['problems'])} errors {v['errors']}")

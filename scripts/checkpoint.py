import sys,pathlib,zipfile,json
root=pathlib.Path(__file__).resolve().parent.parent
stage=sys.argv[1]; label=sys.argv[2] if len(sys.argv)>2 else stage
p=root/'package.json';v=json.loads(p.read_text());v['version']=f'0.{stage}.0';p.write_text(json.dumps(v,indent=2)+'\n')
lock=root/'package-lock.json';lk=json.loads(lock.read_text());lk['version']=v['version'];lk['packages']['']['version']=v['version'];lock.write_text(json.dumps(lk,indent=2)+'\n')
with (root/'docs/PROGRESS.md').open('a') as f:f.write(f'\n## Этап {stage}\n{label}\n')
out=root.parent/'cosmic-releases'/f'hellar-cosmic-stage-{stage}.zip'
out.parent.mkdir(parents=True,exist_ok=True)
skip={'node_modules','dist','dist-server','data','.git','coverage'}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for x in sorted(root.rglob('*')):
  rel=x.relative_to(root)
  if x.is_file() and not x.is_symlink() and not any(part in skip for part in rel.parts) and not (x.name.startswith('.env') and x.name!='.env.example') and not x.name.endswith(('.log','.sqlite','.db')):z.write(x,'hellar-cosmic/'+str(rel))
print(out)

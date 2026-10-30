// Wine 없이 Dayline.exe에 아이콘과 이름(버전 정보)을 넣는다
import fs from 'node:fs';
import * as PE from 'pe-library';
import * as ResEdit from 'resedit';

const exePath = process.argv[2];
const icoPath = process.argv[3];
// 버전은 따로 주지 않으면 package.json에서 읽는다
const version = process.argv[4] || JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const data = fs.readFileSync(exePath);
const exe = PE.NtExecutable.from(data, { ignoreCert: true });
const res = PE.NtExecutableResource.from(exe);

const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
const groupId = groups.length ? groups[0].id : 1;
const lang = groups.length ? groups[0].lang : 1033;
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const [a, b, c] = version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
const langs = vi.getAllLanguagesForStringValues();
for (const l of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) {
  vi.setStringValues(l, {
    FileDescription: 'Dayline',
    ProductName: 'Dayline',
    CompanyName: 'Dayline',
    InternalName: 'Dayline',
    OriginalFilename: 'Dayline.exe',
    LegalCopyright: 'Copyright © 2026 Kim Aeri',
    FileVersion: version,
    ProductVersion: version,
  });
}
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('Dayline.exe 아이콘·이름 설정 완료');

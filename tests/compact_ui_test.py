from pathlib import Path
from lxml import html
import json,re,unittest
ROOT=Path(__file__).parents[1]/'extension'
class CompactUI(unittest.TestCase):
 def setUp(self):self.doc=html.fromstring((ROOT/'popup.html').read_text())
 def test_all_script_bindings_resolve(self):
  ids=self.doc.xpath('//@id');self.assertEqual(len(ids),len(set(ids)))
  for name in ['popup.js','extras.js']:
   source=(ROOT/name).read_text();used=set(re.findall(r"\$\('([^']+)'\)",source))|set(re.findall(r"bind\('([^']+)'",source));self.assertFalse(used-set(ids),used-set(ids))
 def test_every_navigation_has_view(self):
  views=set(self.doc.xpath('//section/@id'))
  for view in self.doc.xpath('//nav/button/@data-view'):self.assertIn(view,views)
 def test_run_controls_outside_scrolling_views(self):
  for name in ['start','stop','resume','openFull']:
   button=self.doc.get_element_by_id(name);self.assertEqual(button.getparent().get('class'),'runbar')
 def test_assets_exist(self):
  m=json.loads((ROOT/'manifest.json').read_text());paths=[*m['icons'].values(),m['background']['service_worker'],m['side_panel']['default_path'].split('?')[0]]+self.doc.xpath('//script/@src')+self.doc.xpath('//link[@rel="stylesheet"]/@href')
  self.assertTrue(all((ROOT/p).is_file() for p in paths))
 def test_server_credentials_are_not_in_backup_whitelist(self):
  source=(ROOT/'extras.js').read_text();self.assertIn("['savedFormData','groupPresets','scheduleConfig']",source);self.assertNotIn('deviceSecret',source)
 def test_fixed_shell_and_internal_lists(self):
  css=(ROOT/'popup.css').read_text();self.assertIn('height:590px',css);self.assertIn('grid-template-rows:48px 42px 36px minmax(0,1fr) 54px 18px',css);self.assertIn('overflow:hidden',css);self.assertNotIn('100vw',css);self.assertNotIn('@media(max-width',css);self.assertIn('.results{flex:1;min-height:0;max-height:none;overflow:auto}',css)
if __name__=='__main__':unittest.main(verbosity=2)

import pathlib,tempfile,unittest,zipfile
from converter import preflight,convert,MAX_BYTES
class ConverterChecks(unittest.TestCase):
 def test_administrator_large_source_and_201_pages(self):
  import fitz
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);large=root/'large.pdf'
   with large.open('wb') as f:f.write(b'%PDF-');f.truncate(MAX_BYTES+1)
   with self.assertRaises(ValueError):preflight(large)
   preflight(large,unlimited=True)
   doc=fitz.open()
   for _ in range(201):doc.new_page()
   doc.save(root/'admin.pdf');doc.close()
   result=convert(root/'admin.pdf',root/'admin-result',unlimited=True);self.assertEqual(result['pages'],201)
 @classmethod
 def setUpClass(cls):
  tempfile.tempdir=str(pathlib.Path(__file__).parent/'work');pathlib.Path(tempfile.tempdir).mkdir(exist_ok=True)
 def test_pdf_end_to_end(self):
  import fitz
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);pdf=root/'a.pdf';doc=fitz.open();p=doc.new_page();p.insert_text((40,60),'project management');doc.save(pdf);doc.close()
   result=convert(pdf,root/'result');self.assertEqual(result['pages'],1);self.assertTrue(result['searchable']);self.assertEqual({x['kind'] for x in result['assets']},{'page','thumbnail','text'})
   for a in result['assets']:self.assertEqual((root/'result'/a['file']).stat().st_size,a['bytes'])
 def test_encrypted_and_201_pages(self):
  import fitz
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);doc=fitz.open()
   for _ in range(201):doc.new_page()
   doc.save(root/'big.pdf');doc.close()
   with self.assertRaises(ValueError):convert(root/'big.pdf',root/'result')
   doc=fitz.open(root/'big.pdf');doc.delete_page(200);doc.save(root/'valid200.pdf');doc.close();self.assertEqual(convert(root/'valid200.pdf',root/'valid-result')['pages'],200)
 def test_archive_rejection(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'unsafe.pptx'
   with zipfile.ZipFile(p,'w') as z:
    z.writestr('[Content_Types].xml','x');z.writestr('ppt/presentation.xml','x');z.writestr('ppt/slides/slide1.xml','x');z.writestr('ppt/vbaProject.bin','macro')
   with self.assertRaises(ValueError):preflight(p)
 def test_fake_pdf(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'fake.pdf';p.write_bytes(b'not pdf')
   with self.assertRaises(ValueError):preflight(p)
if __name__=='__main__':unittest.main()

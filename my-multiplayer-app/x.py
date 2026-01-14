import xml.etree.ElementTree as E, collections as C; print(C.Counter(e.tag.split('}')[-1] for e in E.parse('test_page_1.svg').iter()))

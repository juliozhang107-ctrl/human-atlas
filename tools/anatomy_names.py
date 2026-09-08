"""Detailed anatomical names for the segmentation classes.

The source names are short identifiers meant for a model's output directory, not for a reader:
`autochthon_left` is the deep intrinsic back muscle group, and calling it "Left autochthon" on an
image tells a reader almost nothing. Each class here carries the name a report would use and its
Terminologia Anatomica term, so a section can be read in the words a radiologist would write."""

def _ordinal(n):
    return {1:'First',2:'Second',3:'Third',4:'Fourth',5:'Fifth',6:'Sixth',7:'Seventh',8:'Eighth',
            9:'Ninth',10:'Tenth',11:'Eleventh',12:'Twelfth'}[n]

NAMES = {
 # Central nervous system and head
 'brain':        ('Brain', 'Encephalon'),
 'skull':        ('Skull', 'Cranium'),
 'spinal_cord':  ('Spinal cord', 'Medulla spinalis'),
 # Airway, thyroid, oesophagus
 'trachea':      ('Trachea', 'Trachea'),
 'thyroid_gland':('Thyroid gland', 'Glandula thyroidea'),
 'esophagus':    ('Oesophagus', 'Oesophagus'),
 # Lungs
 'lung_left':             ('Left lung', 'Pulmo sinister'),
 'lung_right':            ('Right lung', 'Pulmo dexter'),
 'lung_upper_lobe_left':  ('Left upper lobe', 'Lobus superior pulmonis sinistri'),
 'lung_lower_lobe_left':  ('Left lower lobe', 'Lobus inferior pulmonis sinistri'),
 'lung_upper_lobe_right': ('Right upper lobe', 'Lobus superior pulmonis dextri'),
 'lung_middle_lobe_right':('Right middle lobe', 'Lobus medius pulmonis dextri'),
 'lung_lower_lobe_right': ('Right lower lobe', 'Lobus inferior pulmonis dextri'),
 # Heart and great vessels
 'heart':                 ('Heart', 'Cor'),
 'atrial_appendage_left': ('Left atrial appendage', 'Auricula atrii sinistri'),
 'aorta':                 ('Aorta', 'Aorta'),
 'pulmonary_vein':        ('Pulmonary veins', 'Venae pulmonales'),
 'superior_vena_cava':    ('Superior vena cava', 'Vena cava superior'),
 'inferior_vena_cava':    ('Inferior vena cava', 'Vena cava inferior'),
 'brachiocephalic_trunk': ('Brachiocephalic trunk', 'Truncus brachiocephalicus'),
 'brachiocephalic_vein_left': ('Left brachiocephalic vein', 'Vena brachiocephalica sinistra'),
 'brachiocephalic_vein_right':('Right brachiocephalic vein', 'Vena brachiocephalica dextra'),
 'common_carotid_artery_left': ('Left common carotid artery', 'Arteria carotis communis sinistra'),
 'common_carotid_artery_right':('Right common carotid artery', 'Arteria carotis communis dextra'),
 'subclavian_artery_left':  ('Left subclavian artery', 'Arteria subclavia sinistra'),
 'subclavian_artery_right': ('Right subclavian artery', 'Arteria subclavia dextra'),
 'portal_vein_and_splenic_vein': ('Portal and splenic veins', 'Vena portae hepatis et vena splenica'),
 'iliac_artery_left':  ('Left common iliac artery', 'Arteria iliaca communis sinistra'),
 'iliac_artery_right': ('Right common iliac artery', 'Arteria iliaca communis dextra'),
 'iliac_vena_left':    ('Left common iliac vein', 'Vena iliaca communis sinistra'),
 'iliac_vena_right':   ('Right common iliac vein', 'Vena iliaca communis dextra'),
 # Abdominal viscera
 'liver':        ('Liver', 'Hepar'),
 'gallbladder':  ('Gallbladder', 'Vesica biliaris'),
 'spleen':       ('Spleen', 'Splen'),
 'pancreas':     ('Pancreas', 'Pancreas'),
 'stomach':      ('Stomach', 'Gaster'),
 'duodenum':     ('Duodenum', 'Duodenum'),
 'small_bowel':  ('Small bowel', 'Intestinum tenue'),
 'colon':        ('Colon', 'Colon'),
 'kidney_left':  ('Left kidney', 'Ren sinister'),
 'kidney_right': ('Right kidney', 'Ren dexter'),
 'adrenal_gland_left':  ('Left adrenal gland', 'Glandula suprarenalis sinistra'),
 'adrenal_gland_right': ('Right adrenal gland', 'Glandula suprarenalis dextra'),
 'urinary_bladder': ('Urinary bladder', 'Vesica urinaria'),
 'prostate':     ('Prostate', 'Prostata'),
 # Axial skeleton
 'sternum':      ('Sternum', 'Sternum'),
 'sacrum':       ('Sacrum', 'Os sacrum'),
 'costal_cartilages': ('Costal cartilages', 'Cartilagines costales'),
 'intervertebral_discs': ('Intervertebral discs', 'Disci intervertebrales'),
 'vertebrae':    ('Vertebral column', 'Columna vertebralis'),
 # Appendicular skeleton
 'clavicula_left':  ('Left clavicle', 'Clavicula sinistra'),
 'clavicula_right': ('Right clavicle', 'Clavicula dextra'),
 'scapula_left':    ('Left scapula', 'Scapula sinistra'),
 'scapula_right':   ('Right scapula', 'Scapula dextra'),
 'humerus_left':    ('Left humerus', 'Humerus sinister'),
 'humerus_right':   ('Right humerus', 'Humerus dexter'),
 'hip_left':        ('Left hip bone', 'Os coxae sinistrum'),
 'hip_right':       ('Right hip bone', 'Os coxae dextrum'),
 'femur_left':      ('Left femur', 'Femur sinistrum'),
 'femur_right':     ('Right femur', 'Femur dextrum'),
 # Muscles
 'autochthon_left':  ('Left erector spinae', 'Musculi dorsi proprii sinistri'),
 'autochthon_right': ('Right erector spinae', 'Musculi dorsi proprii dextri'),
 'iliopsoas_left':   ('Left iliopsoas', 'Musculus iliopsoas sinister'),
 'iliopsoas_right':  ('Right iliopsoas', 'Musculus iliopsoas dexter'),
 'gluteus_maximus_left':  ('Left gluteus maximus', 'Musculus gluteus maximus sinister'),
 'gluteus_maximus_right': ('Right gluteus maximus', 'Musculus gluteus maximus dexter'),
 'gluteus_medius_left':   ('Left gluteus medius', 'Musculus gluteus medius sinister'),
 'gluteus_medius_right':  ('Right gluteus medius', 'Musculus gluteus medius dexter'),
 'gluteus_minimus_left':  ('Left gluteus minimus', 'Musculus gluteus minimus sinister'),
 'gluteus_minimus_right': ('Right gluteus minimus', 'Musculus gluteus minimus dexter'),
 'sartorius_left':   ('Left sartorius', 'Musculus sartorius sinister'),
 'sartorius_right':  ('Right sartorius', 'Musculus sartorius dexter'),
 'quadriceps_femoris_left':  ('Left quadriceps femoris', 'Musculus quadriceps femoris sinister'),
 'quadriceps_femoris_right': ('Right quadriceps femoris', 'Musculus quadriceps femoris dexter'),
 'thigh_medial_compartment_left':  ('Left medial thigh compartment (adductors)', 'Compartimentum femoris mediale sinistrum'),
 'thigh_medial_compartment_right': ('Right medial thigh compartment (adductors)', 'Compartimentum femoris mediale dextrum'),
 'thigh_posterior_compartment_left':  ('Left posterior thigh compartment (hamstrings)', 'Compartimentum femoris posterius sinistrum'),
 'thigh_posterior_compartment_right': ('Right posterior thigh compartment (hamstrings)', 'Compartimentum femoris posterius dextrum'),
}

# Vertebrae. C1 and C2 carry the names a report uses; the rest are named by region and number.
_REGION = {'C': ('cervical', 'cervicalis'), 'T': ('thoracic', 'thoracica'), 'L': ('lumbar', 'lumbalis'),
           'S': ('sacral', 'sacralis')}
for _letter, (_english, _latin) in _REGION.items():
    for _n in range(1, 13):
        _key = f'vertebrae_{_letter}{_n}'
        if _letter == 'C' and _n == 1: NAMES[_key] = ('Atlas (C1)', 'Atlas')
        elif _letter == 'C' and _n == 2: NAMES[_key] = ('Axis (C2)', 'Axis')
        else: NAMES[_key] = (f'{_ordinal(_n)} {_english} vertebra ({_letter}{_n})',
                             f'Vertebra {_latin} {_n}')
for _side, _english, _latin in (('left', 'Left', 'sinistra'), ('right', 'Right', 'dextra')):
    for _n in range(1, 13):
        NAMES[f'rib_{_side}_{_n}'] = (f'{_english} {_ordinal(_n).lower()} rib', f'Costa {_n} {_latin}')

# Which display system a class belongs to, so a label on a section can be coloured the way the 3D
# model already colours its systems. Matched by longest prefix, which keeps `iliac_artery` apart from
# `iliac_vena` and `iliopsoas`, and lets one `rib_` rule cover all twenty-four ribs. Anything
# unmatched resolves to '' and is reported by scripts/validate-imaging.mjs rather than guessed at.
SYSTEM_RULES = {
 'skeletal':     ('clavicula', 'femur', 'hip', 'humerus', 'rib_', 'sacrum', 'scapula', 'skull',
                  'sternum', 'vertebrae'),
 'connective':   ('costal_cartilages', 'intervertebral_discs'),
 'muscular':     ('autochthon', 'gluteus_', 'iliopsoas', 'quadriceps_femoris', 'sartorius', 'thigh_'),
 'cardiac':      ('heart', 'atrial_appendage'),
 'arterial':     ('aorta', 'brachiocephalic_trunk', 'common_carotid_artery', 'subclavian_artery',
                  'iliac_artery'),
 'venous':       ('brachiocephalic_vein', 'inferior_vena_cava', 'superior_vena_cava',
                  'pulmonary_vein', 'portal_vein', 'iliac_vena'),
 'nervous':      ('brain', 'spinal_cord'),
 'respiratory':  ('trachea', 'lung_'),
 'digestive':    ('colon', 'duodenum', 'esophagus', 'gallbladder', 'liver', 'pancreas',
                  'small_bowel', 'stomach'),
 'urinary':      ('kidney', 'urinary_bladder'),
 'lymphatic':    ('spleen',),
 'endocrine':    ('adrenal_gland', 'thyroid_gland'),
 'reproductive': ('prostate',),
}

_BY_PREFIX = sorted(((prefix, system) for system, prefixes in SYSTEM_RULES.items()
                     for prefix in prefixes), key=lambda rule: -len(rule[0]))


def system_for(source):
    """The display system a segmentation class belongs to, or '' when it is not classified."""
    for prefix, system in _BY_PREFIX:
        if source.startswith(prefix): return system
    return ''


def describe(source):
    """The reported name and Terminologia Anatomica term for a segmentation class."""
    if source in NAMES: return NAMES[source]
    # Anything unmapped still reads sensibly rather than as an identifier.
    words = source.replace('_', ' ')
    return (words[:1].upper() + words[1:], '')

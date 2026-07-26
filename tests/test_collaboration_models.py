from compagnon.collaboration_models import TranslationDiscovery


def test_same_discovery_has_same_fingerprint():
    a = TranslationDiscovery("quest", "Bring me 10 wolf pelts.", "123", {"field": "objective"})
    b = TranslationDiscovery("quest", "Bring me 10 wolf pelts.", "123", {"field": "objective"})
    assert a.fingerprint() == b.fingerprint()


def test_same_text_different_source_is_distinct():
    a = TranslationDiscovery("quest", "Complete", "1", {"field": "title"})
    b = TranslationDiscovery("quest", "Complete", "2", {"field": "title"})
    assert a.fingerprint() != b.fingerprint()


def test_same_text_different_field_is_distinct():
    a = TranslationDiscovery("quest", "Complete", "1", {"field": "title"})
    b = TranslationDiscovery("quest", "Complete", "1", {"field": "objective"})
    assert a.fingerprint() != b.fingerprint()

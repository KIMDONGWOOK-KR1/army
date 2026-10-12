from pathlib import Path

import pytest

from pv.evaldata import assign_folds, cross_site_negatives, load_manifest

HEADER = "path,site_id,label,session,angle,distance,time,weather,occlusion\n"


def write(tmp_path, rows):
    p = tmp_path / "manifest.csv"
    p.write_text(HEADER + "".join(rows), encoding="utf-8")
    return p


def test_load_manifest_resolves_paths_and_tags(tmp_path):
    p = write(tmp_path, ["images/a.jpg,gate,pos,s1,front,near,day,clear,none\n"])
    [s] = load_manifest(p)
    assert s.path == tmp_path / "images" / "a.jpg"
    assert (s.site_id, s.label, s.session, s.tags["angle"]) == ("gate", "pos", "s1", "front")


def test_bad_label_and_missing_column_rejected(tmp_path):
    with pytest.raises(ValueError):
        load_manifest(write(tmp_path, ["a.jpg,gate,maybe,s1,,,,,\n"]))
    bad = tmp_path / "m2.csv"
    bad.write_text("path,site_id\na.jpg,gate\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_manifest(bad)


def test_folds_need_two_sessions(tmp_path):
    two = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n", "b.jpg,gate,pos,s2,,,,,\n"]))
    assert assign_folds(two) == {"s1": 0, "s2": 1}
    one = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n"]))
    with pytest.raises(ValueError):
        assign_folds(one)


def test_cross_site_negatives_from_other_sites(tmp_path):
    samples = load_manifest(write(tmp_path, ["a.jpg,gate,pos,s1,,,,,\n", "b.jpg,gate,hard_neg,s1,,,,,\n"]))
    out = cross_site_negatives(samples, ["gate", "yongbong"])
    assert [(s.site_id, s.label, s.path.name) for s in out] == [("yongbong", "cross_neg", "a.jpg")]

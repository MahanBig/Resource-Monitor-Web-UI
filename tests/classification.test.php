<?php
// Run with: php tests/classification.test.php
declare(strict_types=1);

require __DIR__ . '/../Frontend/api/bootstrap.php';

$rules = load_error_rules();
$cases = json_decode((string) file_get_contents(__DIR__ . '/classification-cases.json'), true);
$failures = 0;

foreach ($cases as $case) {
    $category = classify_error(parse_error_string($case['message']), $rules);
    if ($category !== $case['category']) {
        $failures++;
        fwrite(STDERR, sprintf("FAIL %s: expected %s, got %s\n", $case['message'], var_export($case['category'], true), var_export($category, true)));
    }
}

$checks = [
    [detect_toner_color(parse_error_string('Nesten tom: sort toner')), 'black'],
    [detect_toner_color(parse_error_string('Toner low {10074}')), 'magenta'],
    [detect_toner_color(parse_error_string('Replace waste toner bottle')), 'waste'],
    [detect_paper_tray(parse_error_string('Tomt for papir: magasin 3')), '3'],
    [printer_identifier(['Serial' => '', 'IP' => '10.0.0.1']), 'ip:10.0.0.1'],
    [toner_level_for_color(['Ink Levels' => ['40%', '100%', '-3%', '20%', '9%']], 'yellow'), 9],
    [toner_level_for_color(['Ink Levels' => ['40%', '100%', '-3%']], 'cyan'), null],
    [toner_level_for_color(['Supplies' => [['color' => 'cyan', 'percent' => 77]]], 'cyan'), 77],
    [snapshot_time(['Timestamp' => '2026-11-01T09:41:00+01:00']), '2026-11-01 09:41:00'],
    [snapshot_time(['Time' => '01 11 2026, 09:41']), '2026-11-01 09:41:00'],
];
foreach ($checks as $i => [$actual, $expected]) {
    if ($actual !== $expected) {
        $failures++;
        fwrite(STDERR, sprintf("FAIL check %d: expected %s, got %s\n", $i, var_export($expected, true), var_export($actual, true)));
    }
}

echo $failures === 0 ? 'OK (' . (count($cases) + count($checks)) . " checks)\n" : "{$failures} failure(s)\n";
exit($failures === 0 ? 0 : 1);

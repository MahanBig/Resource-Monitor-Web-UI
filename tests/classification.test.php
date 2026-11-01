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

$recent = (new DateTimeImmutable('-1 hour', app_timezone()))->setTime((int) date('H', time() - 3600), (int) date('i', time() - 3600));
$checks = [
    [detect_toner_color(parse_error_string('Nesten tom: sort toner')), 'black'],
    [detect_toner_color(parse_error_string('Toner low {10074}')), 'magenta'],
    [detect_toner_color(parse_error_string('Replace waste toner bottle')), 'waste'],
    [detect_paper_tray(parse_error_string('Tomt for papir: magasin 3')), '3'],
    [printer_identifier(['Serial' => '', 'IP' => '10.0.0.1']), 'ip:10.0.0.1'],
    [toner_level_for_color(['Ink Levels' => ['40%', '100%', '-3%', '20%', '9%']], 'yellow'), 9],
    [toner_level_for_color(['Ink Levels' => ['40%', '100%', '-3%']], 'cyan'), null],
    [toner_level_for_color(['Supplies' => [['color' => 'cyan', 'percent' => 77]]], 'cyan'), 77],
    [snapshot_time(['Timestamp' => $recent->format(DATE_ATOM)]), $recent->format('Y-m-d H:i:s')],
    [snapshot_time(['Time' => $recent->format('d m Y, H:i')]), $recent->format('Y-m-d H:i:00')],
    // Implausible timestamps fall back to "now"
    [abs(strtotime(snapshot_time(['Timestamp' => '2199-01-01T00:00:00Z'])) - time()) < 5, true],
    [scalar_text(['nested']), ''],
    [strlen(printer_identifier(['Name' => str_repeat('x', 500)])), 160],
];
foreach ($checks as $i => [$actual, $expected]) {
    if ($actual !== $expected) {
        $failures++;
        fwrite(STDERR, sprintf("FAIL check %d: expected %s, got %s\n", $i, var_export($expected, true), var_export($actual, true)));
    }
}

echo $failures === 0 ? 'OK (' . (count($cases) + count($checks)) . " checks)\n" : "{$failures} failure(s)\n";
exit($failures === 0 ? 0 : 1);

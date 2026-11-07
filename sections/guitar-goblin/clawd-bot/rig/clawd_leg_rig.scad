// Clawd crab robot (v2): single-leg test rig.
// One leg module exactly as in the robot (lift servo + Scotch yoke, carriage on two 3 mm rods with LM3UU bushings,
// swing servo on the carriage, rigid 16 mm leg) on a bench stand with a floor and a shell-slot gauge.
// https://boofers-den.vercel.app/sections/guitar-goblin/clawd-bot/
//
// Coordinates (mm) are the robot's: x out from the body, y up (0 = the floor), z forward. This is a front-right module.
// Export a part:   openscad -D 'part="carriage"' -o carriage.stl clawd_leg_rig.scad
// part:  base | column | carriage | leg | crank | assembly
// mode:  "print" lays a part out for the bed (Z up, sitting on Z = 0);
//        "rig" leaves it in rig coordinates (Y up), as the web preview and the clearance checks use it.

part = "assembly";
mode = "print";
swing = 0;   // joint angles for mode = "rig" / the assembly (deg): swing + = foot forward,
lift = 0;    // lift + = carriage up. Carriage (swing axis) height = yokeY + crank * sin(lift).

/* [Robot geometry: the same numbers as gait.js] */
legX = 55;      // leg centre plane
legZ = 36;      // swing axis, forward of the module centre
legLen = 56;    // swing axis to the sole
legW = 16;      // square leg
legTop = 6;     // leg above the swing axis
toeR = 4;       // rounded toe along x: keeps the sole's corners off the floor at full swing
crank = 16;     // lift crank: shaft to pin
yokeY = 61;     // lift shaft height = middle of the carriage travel
liftZ = 8;      // lift shaft, forward of the module centre
shellY = 28;    // underside of the robot's shell (the slot gauge sits here)
slotW = 20; slotL = 44;  // leg slot in the shell underside

/* [MG90S: measure yours] */
sL = 22.8;      // body length (along the tabs)
sW = 12.2;      // body width
sBelow = 16.0;  // body below the tabs
tabT = 2.5;     // tab thickness
tabSpan = 32.5; // tab tip to tip
tabHole = 27.8; // tab screw hole spacing
sAbove = 9.5;   // housing above the tabs, to the top face
bossH = 4;      // output spline boss above the top face
bossD = 7;
shaftOff = 5.5; // shaft centre to body centre, along the length (the body sits above the shaft)
hornGap = 0.5;  // top face to the underside of the horn

/* [Printing fits] */
clr = 0.25;     // sliding and pocket clearance
lmD = 7; lmL = 10; lmFit = 0.10;   // LM3UU outside diameter, length, press-fit allowance
rod = 3; rodFit = 0.10;            // guide rod, allowance in the frame holes (press or a drop of CA glue)
pinD = 2;       // the yoke pin is an M2 screw
pilot = 1.7;    // M2 self-tapping pilot
m3 = 3.4;       // M3 clearance
m4 = 4.5;       // bench screw clearance
plateT = 3;     // servo plates
$fn = 48;

/* derived */
swingTop = legX - legW / 2 - hornGap;            // swing servo top face (46.5)
liftTop = swingTop - 4.5;                        // lift servo top face, 4.5 inboard so its crank clears the leg (42)
carPlate = swingTop - sAbove - tabT - plateT;    // carriage plate, inboard face (31.5)
liftPlate = liftTop - sAbove - tabT - plateT;    // lift servo plate, inboard face (27)
colX = liftPlate + plateT - sBelow - 1;          // column face, 1 mm inboard of the lift servo body (13)
colX0 = colX - 6;
rodX = 25.5;
rodZ = [legZ - 13, legZ + 13];
housingD = lmD + 4;
carMin = 51.5; carMax = 70;                      // carriage travel used by the gaits
deck0 = 28; deck1 = 87;                          // rod blocks (the robot's base and top decks)
rodLen = deck1 + 6 - deck0;                      // 65
pinLen = 10;

function carY(l) = yokeY + crank * sin(l);

module box(x0, x1, y0, y1, z0, z1) translate([x0, y0, z0]) cube([x1 - x0, y1 - y0, z1 - z0]);
module cylX(x0, x1, y, z, d) translate([x0, y, z]) rotate([0, 90, 0]) cylinder(h = x1 - x0, d = d);
module cylY(y0, y1, x, z, d) translate([x, y0, z]) rotate([-90, 0, 0]) cylinder(h = y1 - y0, d = d);

// MG90S envelope: shaft along +x, origin on the top face at the shaft, body above the shaft (+y).
module mg90s() {
  box(-sAbove, 0, shaftOff - sL / 2, shaftOff + sL / 2, -sW / 2, sW / 2);
  box(-sAbove - tabT, -sAbove, shaftOff - tabSpan / 2, shaftOff + tabSpan / 2, -sW / 2, sW / 2);
  box(-sAbove - tabT - sBelow, -sAbove - tabT, shaftOff - sL / 2, shaftOff + sL / 2, -sW / 2, sW / 2);
  cylX(0, bossH, 0, 0, bossD);
}
// The hole a servo drops through, plus its tab screw pilots, in a plate whose outboard face is at x = 0.
module servoPocket(t) {
  box(-t - 1, 1, shaftOff - sL / 2 - clr, shaftOff + sL / 2 + clr, -sW / 2 - clr, sW / 2 + clr);
  for (s = [-1, 1]) cylX(-t - 1, 1, shaftOff + s * tabHole / 2, 0, pilot);
}
// Single-arm horn pocket in a face at x = 0 with the material on the -x side: hub recess `depth` deep, arm along y to `reach`.
module hornPocket(depth, reach) {
  cylX(-depth, 0.01, 0, 0, bossD + 0.6);
  hull() { cylX(-2.2, 0.01, 0, 0, bossD + 0.6); translate([0, reach, 0]) cylX(-2.2, 0.01, 0, 0, 5); }
}

/* ---------- printed parts, in rig coordinates ---------- */

// Bench plate. Its top is the floor (y = 0) the foot steps on.
module base() {
  difference() {
    box(-12, 88, -5, 0, -26, 84);
    for (z = [-2, 26, 54]) { cylY(-6, 1, colX + 11, z, m3); cylY(-6, -2.5, colX + 11, z, 6.4); }   // M3 + nut/head recess
    for (x = [-5, 81]) for (z = [-19, 77]) { cylY(-6, 1, x, z, m4); cylY(-1.8, 1, x, z, 9); }        // bench screws, countersunk
  }
}

// Upright: rod blocks (the robot's two decks), the lift servo mount, and a plate with the shell's leg slot.
module column() {
  difference() {
    union() {
      box(colX0, colX, 0, 96, -8, 62);
      box(colX, 30, 0, 5, -8, 62);                                               // foot flange
      for (y = [deck0, deck1]) for (z = rodZ) box(colX, rodX + 4.5, y, y + 6, z - 4.5, z + 4.5);
      box(liftPlate, liftPlate + plateT, 44, 89, liftZ - sW / 2 - 2.5, liftZ + sW / 2 + 2.5);   // lift servo plate
      for (y = [44, 87]) box(colX, liftPlate, y, y + 2, liftZ - sW / 2 - 2.5, liftZ + sW / 2 + 2.5);
      box(colX, liftPlate + plateT, 44, 89, liftZ - sW / 2 - 4.5, liftZ - sW / 2 - 2.5);   // side wall, shares a face with the plate
      box(colX, legX + slotW / 2 + 6, shellY - 3, shellY, legZ - slotL / 2 - 6, legZ + slotL / 2 + 6);   // slot gauge
    }
    for (y = [deck0 - 1]) for (z = rodZ) cylY(y, deck1 + 7, rodX, z, rod + rodFit);
    translate([liftPlate + plateT, yokeY, liftZ]) servoPocket(plateT);
    box(legX - slotW / 2, legX + slotW / 2, shellY - 4, shellY + 1, legZ - slotL / 2, legZ + slotL / 2);
    for (z = [-2, 26, 54]) cylY(-1, 6, colX + 11, z, m3);
  }
}

// Carriage, relative to the swing axis (y = 0 there). Swing servo pocket, two LM3UU housings, and the yoke block
// whose slot the lift pin rides in.
module carriage() {
  difference() {
    union() {
      box(carPlate, carPlate + plateT, -13, 24, rodZ[0] - 5.5, rodZ[1] + 5.5);
      for (z = rodZ) {
        cylY(-13, -1, rodX, z, housingD);
        box(rodX, carPlate + 0.5, -13, -1, z - 3, z + 3);
      }
      hull() {                                                                  // yoke block, chamfered underneath
        box(carPlate, liftTop, -6, 6, rodZ[0] - 5.5, rodZ[0] + 4.5);
        box(carPlate, carPlate + plateT, -13, -12, rodZ[0] - 5.5, rodZ[0] + 4.5);
      }
    }
    translate([carPlate + plateT, 0, legZ]) servoPocket(plateT);
    for (z = rodZ) { cylY(-11, 0, rodX, z, lmD + lmFit); cylY(-14, 0, rodX, z, rod + 1); }
    // yoke slot: pin centre travels z = liftZ + crank*cos(lift) for the gaits' lift range, y = 0
    box(liftTop - 6, liftTop + 1, -pinD / 2 - 0.15, pinD / 2 + 0.15,
        liftZ + crank * cos(37) - pinD / 2 - clr, liftZ + crank + pinD / 2 + clr);
  }
}

// Rigid leg, relative to the swing axis (y = 0, z = legZ there). The swing servo's single-arm horn sits in a pocket
// on its inboard face, arm pointing down the leg. It ends in a half-round toe (radius toeR) instead of a flat sole:
// a tilted flat sole would put its corner 3 mm into the floor at full swing.
module leg() {
  difference() {
    union() {
      box(legX - legW / 2, legX + legW / 2, -legLen + toeR, legTop, legZ - legW / 2, legZ + legW / 2);
      cylX(legX - legW / 2, legX + legW / 2, -legLen + toeR, legZ, 2 * toeR);   // rounded toe: the contact point
    }
    translate([legX - legW / 2, 0, legZ]) mirror([1, 0, 0]) hornPocket(4.5, -14);
    for (y = [-8, -12]) cylX(legX - legW / 2 - 1, legX - legW / 2 + 8, y, legZ, 1.2);
  }
}

// Lift crank, relative to the lift shaft (y = yokeY, z = liftZ there), pointing +z at lift = 0. Bolts over the
// servo's single-arm horn (trim the arm to 14 mm if it's longer); the pin is an M2 x 10 screw at 16 mm.
module crank() {
  difference() {
    hull() { cylX(liftTop + hornGap, liftTop + hornGap + 4, 0, liftZ, 10); cylX(liftTop + hornGap, liftTop + hornGap + 4, 0, liftZ + crank, 6); }
    cylX(liftTop, liftTop + 6, 0, liftZ, bossD + 0.6);
    hull() { cylX(liftTop, liftTop + hornGap + 2.2, 0, liftZ, bossD + 0.6); cylX(liftTop, liftTop + hornGap + 2.2, 0, liftZ + 12, 5); }
    cylX(liftTop, liftTop + 6, 0, liftZ + crank, pilot);
    for (z = [6, 9]) cylX(liftTop, liftTop + 6, 0, liftZ + z, 1.2);
  }
}

/* ---------- non-printed parts, for the preview and the clearance checks ---------- */
module liftServo() translate([liftTop, yokeY, liftZ]) mg90s();
module swingServo() translate([swingTop, 0, legZ]) mg90s();
module rods() for (z = rodZ) cylY(deck0, deck0 + rodLen, rodX, z, rod);
module bushings() for (z = rodZ) difference() { cylY(-11, -1, rodX, z, lmD); cylY(-12, 0, rodX, z, rod + 0.2); }
module pin() cylX(liftTop + hornGap + 4 - pinLen, liftTop + hornGap + 4, 0, liftZ + crank, pinD);

/* ---------- placement ---------- */
module atCarriage(l) translate([0, carY(l), 0]) children();
module atLeg(s, l) translate([0, carY(l), legZ]) rotate([-s, 0, 0]) translate([0, 0, -legZ]) children();
module atCrank(l) translate([0, yokeY, liftZ]) rotate([-l, 0, 0]) translate([0, 0, -liftZ]) children();

module printPose(p) {
  if (p == "base")          translate([0, 0, 5]) rotate([90, 0, 0]) children();          // top face up
  else if (p == "column")   translate([0, 0, -colX0]) rotate([0, -90, 0]) children();    // lying on its back
  else if (p == "carriage") translate([0, 0, 13]) rotate([90, 0, 0]) children();         // upright, housings vertical
  else children();                                                                         // leg, crank: see below
}

module part(p) {
  if (p == "liftServo") liftServo();
  if (p == "swingServo") swingServo();
  if (p == "rods") rods();
  if (p == "bushings") bushings();
  if (p == "pin") pin();
  if (p == "base") base();
  if (p == "column") column();
  if (p == "carriage") carriage();
  if (p == "leg") leg();
  if (p == "crank") crank();
}

if (part == "assembly") {
  base(); column(); liftServo(); rods();
  atCarriage(lift) { carriage(); swingServo(); bushings(); }
  atLeg(swing, lift) leg();
  atCrank(lift) { crank(); pin(); }
} else if (mode == "rig") {
  part(part);
} else if (part == "leg") {
  translate([0, 0, legX + legW / 2]) rotate([0, 90, 0]) leg();       // outboard face down, horn pocket up
} else if (part == "crank") {
  translate([0, 0, liftTop + hornGap + 4]) rotate([0, 90, 0]) crank();   // outer face down, horn pocket up
} else {
  printPose(part) part(part);
}

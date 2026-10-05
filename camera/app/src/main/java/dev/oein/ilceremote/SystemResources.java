package dev.oein.ilceremote;

import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;

import java.io.ByteArrayOutputStream;

/**
 * Debug helpers for exploring the firmware's framework resources, where Sony keeps the icons of
 * the camera's own display (e.g. 0x01080a9a = s_16_dd_parts_osd_icon_mode_m).
 */
final class SystemResources {
    private SystemResources() {}

    /** "0x01080a9a drawable/s_16_dd_parts_osd_icon_mode_m" lines for ids in [from, from + count). */
    static String list(int from, int count) {
        Resources res = Resources.getSystem();
        StringBuilder out = new StringBuilder();
        for (int id = from; id < from + count; id++) {
            try {
                String name = res.getResourceName(id);
                out.append(String.format("0x%08x %s%n", id, name.substring(name.indexOf(':') + 1)));
            } catch (Resources.NotFoundException e) {
                // gap in the id space
            }
        }
        return out.toString();
    }

    /** The drawable as PNG at its intrinsic size (state 1 = pressed/selected), or null. */
    static byte[] renderPng(int id, int state) {
        Drawable drawable;
        try {
            drawable = Resources.getSystem().getDrawable(id);
        } catch (Resources.NotFoundException e) {
            return null;
        }
        if (state == 1) {
            drawable.setState(new int[] { android.R.attr.state_selected, android.R.attr.state_pressed });
        }
        int w = Math.max(1, drawable.getIntrinsicWidth() > 0 ? drawable.getIntrinsicWidth() : 64);
        int h = Math.max(1, drawable.getIntrinsicHeight() > 0 ? drawable.getIntrinsicHeight() : 64);
        Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        drawable.setBounds(0, 0, w, h);
        drawable.draw(new Canvas(bitmap));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        bitmap.recycle();
        return out.toByteArray();
    }
}

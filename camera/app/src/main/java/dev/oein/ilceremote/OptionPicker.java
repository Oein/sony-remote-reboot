package dev.oein.ilceremote;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.sony.scalar.sysutil.ScalarInput;

import java.util.ArrayList;
import java.util.List;

/**
 * Setting screen in the style of the camera's own (e.g. Drive Mode): a title header with a rule,
 * a column of icons on the left with the current one on an orange box, the highlighted option's
 * name in orange, and a key guide at the bottom. Wheel or up/down moves, centre confirms,
 * MENU / trash / left cancels. UI thread only.
 */
class OptionPicker {
    static class Option {
        final String key;
        final String name;
        final Drawable icon;

        Option(String key, String name, Drawable icon) {
            this.key = key;
            this.name = name;
            this.icon = icon;
        }
    }

    interface Listener {
        void onPicked(Option option);
    }

    private static final int ACCENT = 0xffe8600c;
    private static final int ACCENT_TEXT = 0xffff9a2e;
    private static final int RULE = 0xff9a9a9a;
    private static final int VISIBLE = 4;
    // Frame-buffer pixels; the LCD stretches them 4:3 -> 16:9
    private static final int HEADER_H = 58;
    private static final int FOOTER_H = 44;
    private static final int COLUMN_W = 130;
    private static final int CELL_H = 76;
    private static final int BOX_W = 100;
    private static final int BOX_H = 60;

    private final FrameLayout root;
    private final TextView header;
    private final TextView name;
    private final ImageView[] cells = new ImageView[VISIBLE];
    private final TextView moreUp;
    private final TextView moreDown;

    private final List<Option> options = new ArrayList<Option>();
    private int selected;
    private Listener listener;

    OptionPicker(Context context) {
        root = new FrameLayout(context);
        root.setBackgroundColor(0xa0000000);
        root.setVisibility(View.GONE);

        header = text(context, 21, Color.WHITE);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(28, 0, 0, 0);
        root.addView(header, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.FILL_PARENT, HEADER_H, Gravity.TOP));
        root.addView(rule(context), rule(FrameLayout.LayoutParams.FILL_PARENT, 2, Gravity.TOP, 0, HEADER_H, 0, 0));

        name = text(context, 21, ACCENT_TEXT);
        FrameLayout.LayoutParams nameParams = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.RIGHT);
        nameParams.topMargin = HEADER_H + 10;
        nameParams.rightMargin = 150;
        root.addView(name, nameParams);

        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);
        moreUp = text(context, 12, Color.WHITE);
        moreUp.setText("▲");
        moreUp.setGravity(Gravity.CENTER);
        column.addView(moreUp, new LinearLayout.LayoutParams(COLUMN_W, 16));
        for (int i = 0; i < VISIBLE; i++) {
            ImageView cell = new ImageView(context);
            cell.setScaleType(ImageView.ScaleType.FIT_CENTER);
            cell.setPadding(8, 3, 8, 3);
            FrameLayout box = new FrameLayout(context);
            box.addView(cell, new FrameLayout.LayoutParams(BOX_W, BOX_H, Gravity.CENTER));
            column.addView(box, new LinearLayout.LayoutParams(COLUMN_W, CELL_H));
            cells[i] = cell;
        }
        moreDown = text(context, 12, Color.WHITE);
        moreDown.setText("▼");
        moreDown.setGravity(Gravity.CENTER);
        column.addView(moreDown, new LinearLayout.LayoutParams(COLUMN_W, 16));
        FrameLayout.LayoutParams columnParams = new FrameLayout.LayoutParams(
                COLUMN_W, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.LEFT);
        columnParams.topMargin = HEADER_H + 14;
        columnParams.leftMargin = 24;
        root.addView(column, columnParams);
        root.addView(rule(context), rule(2, FrameLayout.LayoutParams.FILL_PARENT, Gravity.LEFT,
                24 + COLUMN_W, HEADER_H + 2, 0, FOOTER_H));

        root.addView(rule(context), rule(FrameLayout.LayoutParams.FILL_PARENT, 1, Gravity.BOTTOM, 0, 0, 0, FOOTER_H));
        TextView guide = text(context, 16, Color.WHITE);
        guide.setText("◆선택   ●확인   MENU취소");
        guide.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        guide.setPadding(0, 0, 30, 0);
        root.addView(guide, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.FILL_PARENT, FOOTER_H, Gravity.BOTTOM));
    }

    View getView() {
        return root;
    }

    boolean isOpen() {
        return root.getVisibility() == View.VISIBLE;
    }

    void open(String title, List<Option> newOptions, String currentKey, Listener newListener) {
        options.clear();
        options.addAll(newOptions);
        listener = newListener;
        selected = 0;
        for (int i = 0; i < options.size(); i++) {
            if (options.get(i).key.equals(currentKey)) {
                selected = i;
            }
        }
        header.setText(title);
        root.setVisibility(options.isEmpty() ? View.GONE : View.VISIBLE);
        render();
    }

    void close() {
        root.setVisibility(View.GONE);
        listener = null;
    }

    void onDial(int direction) {
        move(direction);
    }

    /** Returns true (every key is consumed while open). */
    boolean onKey(int scanCode) {
        switch (scanCode) {
            case ScalarInput.ISV_KEY_UP:
                move(-1);
                break;
            case ScalarInput.ISV_KEY_DOWN:
                move(1);
                break;
            case ScalarInput.ISV_KEY_ENTER:
                Listener l = listener;
                Option option = options.get(selected);
                close();
                if (l != null) {
                    l.onPicked(option);
                }
                break;
            case ScalarInput.ISV_KEY_MENU:
            case ScalarInput.ISV_KEY_SK1:
            case ScalarInput.ISV_KEY_DELETE:
            case ScalarInput.ISV_KEY_SK2:
            case ScalarInput.ISV_KEY_LEFT:
                close();
                break;
            default:
                break;
        }
        return true;
    }

    private void move(int direction) {
        if (!options.isEmpty()) {
            selected = Math.max(0, Math.min(options.size() - 1, selected + direction));
            render();
        }
    }

    private void render() {
        if (options.isEmpty()) {
            return;
        }
        // Keep the highlighted option in view, scrolling the column like the camera does
        int first = Math.max(0, Math.min(selected - VISIBLE / 2, options.size() - VISIBLE));
        for (int i = 0; i < VISIBLE; i++) {
            int index = first + i;
            ImageView cell = cells[i];
            boolean exists = index < options.size();
            cell.setImageDrawable(exists ? options.get(index).icon : null);
            cell.setBackgroundColor(exists && index == selected ? ACCENT : Color.TRANSPARENT);
        }
        moreUp.setVisibility(first > 0 ? View.VISIBLE : View.INVISIBLE);
        moreDown.setVisibility(first + VISIBLE < options.size() ? View.VISIBLE : View.INVISIBLE);
        name.setText(options.get(selected).name);
    }

    private static TextView text(Context context, int sizeSp, int color) {
        TextView view = new TextView(context);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(SonyFonts.ui());
        view.setTextScaleX(SonyIcons.X_SCALE);
        return view;
    }

    private static View rule(Context context) {
        View view = new View(context);
        view.setBackgroundColor(RULE);
        return view;
    }

    private static FrameLayout.LayoutParams rule(int w, int h, int gravity, int left, int top, int right, int bottom) {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(w, h, gravity);
        params.setMargins(left, top, right, bottom);
        return params;
    }
}

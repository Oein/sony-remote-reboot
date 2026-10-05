package dev.oein.ilceremote;

import android.content.Context;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.sony.scalar.sysutil.ScalarInput;

import java.util.ArrayList;
import java.util.List;

/**
 * On-screen menu in the style of the camera's own: a dark panel, one row per setting, the
 * selected row in orange with its value between arrows. Up/down (or the wheel) moves,
 * left/right changes the value, centre activates, MENU closes. UI thread only.
 */
class CameraMenu {
    interface Item {
        String label();

        /** Current value shown on the right, or null for plain actions. */
        String value();

        /** Change the value; direction is -1 (left) or +1 (right). */
        void change(int direction);

        /** Centre button. Returns true if the menu should close. */
        boolean activate();
    }

    private static final int ACCENT = 0xfff39800;
    private static final int PANEL = 0xe0141414;
    private static final int DIVIDER = 0xff3a3a3a;
    private static final int HINT = 0xff9a9a9a;

    private final Context context;
    private final LinearLayout panel;
    private final LinearLayout rows;
    private final List<Item> items = new ArrayList<Item>();
    private final List<TextView[]> rowViews = new ArrayList<TextView[]>();
    private int selected;
    private boolean open;

    CameraMenu(Context context) {
        this.context = context;
        panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackgroundColor(PANEL);
        panel.setMinimumWidth(dp(300));

        TextView title = text("MENU", 17, ACCENT);
        title.setPadding(dp(14), dp(10), dp(14), dp(8));
        panel.addView(title);
        panel.addView(divider());

        rows = new LinearLayout(context);
        rows.setOrientation(LinearLayout.VERTICAL);
        panel.addView(rows);

        panel.addView(divider());
        TextView hint = text("UP/DOWN Select   LEFT/RIGHT Change   CENTER OK   MENU Close", 12, HINT);
        hint.setPadding(dp(14), dp(6), dp(14), dp(8));
        panel.addView(hint);
        panel.setVisibility(View.GONE);
    }

    View getView() {
        return panel;
    }

    void setItems(List<Item> newItems) {
        items.clear();
        items.addAll(newItems);
        selected = Math.min(selected, Math.max(0, items.size() - 1));
        rows.removeAllViews();
        rowViews.clear();
        for (int i = 0; i < items.size(); i++) {
            LinearLayout row = new LinearLayout(context);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(dp(14), dp(7), dp(14), dp(7));
            TextView label = text("", 16, Color.WHITE);
            TextView value = text("", 16, Color.WHITE);
            value.setGravity(Gravity.RIGHT);
            row.addView(label, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            row.addView(value, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            rows.addView(row);
            rowViews.add(new TextView[] { label, value });
        }
    }

    boolean isOpen() {
        return open;
    }

    void open() {
        open = true;
        render();
    }

    void close() {
        open = false;
        render();
    }

    void onDial(int direction) {
        move(direction);
    }

    /** Returns true if handled (always, while open). */
    boolean onKey(int scanCode) {
        switch (scanCode) {
            case ScalarInput.ISV_KEY_UP:
                move(-1);
                break;
            case ScalarInput.ISV_KEY_DOWN:
                move(1);
                break;
            case ScalarInput.ISV_KEY_LEFT:
                current().change(-1);
                break;
            case ScalarInput.ISV_KEY_RIGHT:
                current().change(1);
                break;
            case ScalarInput.ISV_KEY_ENTER:
                if (current().activate()) {
                    close();
                }
                break;
            case ScalarInput.ISV_KEY_MENU:
            case ScalarInput.ISV_KEY_SK1:
            case ScalarInput.ISV_KEY_DELETE:
            case ScalarInput.ISV_KEY_SK2:
                close();
                break;
            default:
                break;
        }
        render();
        return true;
    }

    private Item current() {
        return items.get(selected);
    }

    private void move(int direction) {
        if (!items.isEmpty()) {
            selected = (selected + direction + items.size()) % items.size();
        }
        render();
    }

    /** Refreshes labels, values and the highlight. */
    void render() {
        panel.setVisibility(open ? View.VISIBLE : View.GONE);
        if (!open) {
            return;
        }
        for (int i = 0; i < items.size(); i++) {
            Item item = items.get(i);
            TextView[] views = rowViews.get(i);
            boolean isSelected = i == selected;
            String value = item.value();
            views[0].setText(item.label());
            views[1].setText(value == null ? "" : isSelected ? "<  " + value + "  >" : value);
            ((View) views[0].getParent()).setBackgroundColor(isSelected ? ACCENT : Color.TRANSPARENT);
            int color = isSelected ? Color.BLACK : Color.WHITE;
            views[0].setTextColor(color);
            views[1].setTextColor(isSelected ? Color.BLACK : ACCENT);
        }
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(context);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTextScaleX(SonyIcons.X_SCALE);
        view.setTypeface(SonyFonts.ui());
        return view;
    }

    private View divider() {
        View line = new View(context);
        line.setBackgroundColor(DIVIDER);
        line.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.FILL_PARENT, 1));
        return line;
    }

    private int dp(int value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }
}
